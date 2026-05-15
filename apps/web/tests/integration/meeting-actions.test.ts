import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration tests for the meeting actions that landed with the
 * ad-hoc group call + guest-by-link work:
 *
 *   - startGroupCallAction   (any active user, explicit roster)
 *   - joinMeetingAction      (roster grant for ad-hoc invitees)
 *   - createMeetingInviteAction
 *   - joinMeetingAsGuestAction  (public, no auth — token IS the auth)
 *
 * What's mocked: LiveKit + Redis (no real SFU), next/cache, auth.
 * Everything DB-side hits the real Postgres so the schema +
 * constraints + cascades are exercised for real.
 *
 * Source: apps/web/actions/meetings.ts
 */

const mockMe = {
  id: '',
  role: 'MEMBER' as 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER',
  name: 'A',
  email: 'a@a',
  image: null,
  mustChangePassword: false,
};

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => mockMe),
  requireRole: vi.fn(async () => mockMe),
  signOut: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// LiveKit & Redis: actions import them but the integration tests
// never need a real SFU. Replace with stubs so module init doesn't
// open sockets at test boot.
vi.mock('ioredis', () => ({
  Redis: class FakeRedis {
    publish() {
      return Promise.resolve(1);
    }
  },
}));
vi.mock('@giper/integrations', () => ({
  buildTurnCredentials: () => [],
  livekitPublicUrl: () => 'wss://lk.test',
  mintAccessToken: async () => 'fake-livekit-jwt',
  stopEgress: async () => undefined,
}));

// Fan-out helper runs `void` from inside the action — we don't want
// real push / Bitrix IM calls during tests. The action awaits a
// `Promise.all`, but only inside the void IIFE; we mock the inner
// modules so they're no-ops + observable via spies if needed.
vi.mock('@/lib/push/sendPush', () => ({
  sendPushToUsers: vi.fn(async () => undefined),
}));
vi.mock('@/lib/integrations/bitrix24Outbound', () => ({
  notifyBitrixPersonalBestEffort: vi.fn(async () => ({ ok: true })),
}));

import { prisma } from '@giper/db';
import {
  startGroupCallAction,
  joinMeetingAction,
  createMeetingInviteAction,
  joinMeetingAsGuestAction,
  endMeetingAction,
} from '@/actions/meetings';
import { makeUser } from './helpers/factories';

beforeEach(() => {
  mockMe.id = '';
  mockMe.role = 'MEMBER';
  mockMe.name = 'A';
});

// ---------------------------------------------------------------------
// startGroupCallAction
// ---------------------------------------------------------------------
describe('startGroupCallAction', () => {
  it('creates an ad-hoc meeting + roster with caller and invitees', async () => {
    const caller = await makeUser({ role: 'MEMBER' });
    const a = await makeUser();
    const b = await makeUser();
    mockMe.id = caller.id;

    const res = await startGroupCallAction({
      title: 'Quick sync',
      participantUserIds: [a.id, b.id],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const meeting = await prisma.meeting.findUnique({
      where: { id: res.meetingId },
      include: { participants: { orderBy: { livekitIdentity: 'asc' } } },
    });
    expect(meeting?.title).toBe('Quick sync');
    expect(meeting?.status).toBe('PLANNED');
    expect(meeting?.channelId).toBeNull();
    expect(meeting?.projectId).toBeNull();
    expect(meeting?.createdById).toBe(caller.id);
    expect(meeting?.livekitRoomName?.startsWith('m_')).toBe(true);

    // Roster: caller + 2 invitees, all with "invite:" placeholder
    // identity (rewritten on actual join).
    const userIds = (meeting?.participants ?? [])
      .map((p) => p.userId)
      .filter((x): x is string => !!x)
      .sort();
    expect(userIds).toEqual([caller.id, a.id, b.id].sort());
    for (const p of meeting?.participants ?? []) {
      expect(p.livekitIdentity.startsWith('invite:')).toBe(true);
    }
  });

  it('title under 2 chars → validation error, no meeting created', async () => {
    const caller = await makeUser();
    const a = await makeUser();
    mockMe.id = caller.id;
    const res = await startGroupCallAction({
      title: ' a ',
      participantUserIds: [a.id],
    });
    expect(res).toMatchObject({ ok: false });
    expect(await prisma.meeting.count()).toBe(0);
  });

  it('empty roster → "Выберите хотя бы одного участника"', async () => {
    const caller = await makeUser();
    mockMe.id = caller.id;
    const res = await startGroupCallAction({
      title: 'Solo call',
      participantUserIds: [],
    });
    expect(res).toMatchObject({ ok: false });
  });

  it('roster containing only the caller → rejected (we dedupe self out)', async () => {
    const caller = await makeUser();
    mockMe.id = caller.id;
    const res = await startGroupCallAction({
      title: 'Self only',
      participantUserIds: [caller.id],
    });
    expect(res).toMatchObject({ ok: false });
  });

  it('roster > 50 invitees → rejected (cap protects against runaway forms)', async () => {
    const caller = await makeUser();
    mockMe.id = caller.id;
    const ids = Array.from({ length: 51 }, (_, i) => `fake-${i}`);
    const res = await startGroupCallAction({
      title: 'Big crowd',
      participantUserIds: ids,
    });
    expect(res).toMatchObject({ ok: false });
    expect(await prisma.meeting.count()).toBe(0);
  });

  it('invitee that does not exist or is inactive → silently dropped, others land', async () => {
    const caller = await makeUser();
    const good = await makeUser();
    const inactive = await makeUser({ isActive: false });
    mockMe.id = caller.id;
    const res = await startGroupCallAction({
      title: 'Mixed',
      participantUserIds: [good.id, inactive.id, 'nonexistent-id'],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const roster = await prisma.meetingParticipant.findMany({
      where: { meetingId: res.meetingId },
      select: { userId: true },
    });
    const ids = roster.map((r) => r.userId).filter(Boolean);
    expect(ids).toContain(caller.id);
    expect(ids).toContain(good.id);
    expect(ids).not.toContain(inactive.id);
    expect(ids).not.toContain('nonexistent-id');
  });

  it('all invitees invalid → "Никто из приглашённых не найден"', async () => {
    const caller = await makeUser();
    mockMe.id = caller.id;
    const res = await startGroupCallAction({
      title: 'Ghost crew',
      participantUserIds: ['ghost-1', 'ghost-2'],
    });
    expect(res).toMatchObject({ ok: false });
    expect(await prisma.meeting.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------
// joinMeetingAction — roster grant for ad-hoc invitees
// ---------------------------------------------------------------------
describe('joinMeetingAction — roster-based access', () => {
  it('invitee on an ad-hoc roster can join', async () => {
    const caller = await makeUser();
    const invitee = await makeUser();
    mockMe.id = caller.id;
    const start = await startGroupCallAction({
      title: 'Roster grant test',
      participantUserIds: [invitee.id],
    });
    expect(start.ok).toBe(true);
    if (!start.ok) return;

    // Now switch identity to the invitee and try to join.
    mockMe.id = invitee.id;
    mockMe.role = 'MEMBER';
    const join = await joinMeetingAction({ meetingId: start.meetingId });
    expect(join.ok).toBe(true);
    if (join.ok) {
      expect(join.token).toBe('fake-livekit-jwt');
      expect(join.identity.startsWith(`user:${invitee.id}:`)).toBe(true);
    }
  });

  it('non-invitee MEMBER cannot join an ad-hoc meeting', async () => {
    const caller = await makeUser();
    const invitee = await makeUser();
    const outsider = await makeUser({ role: 'MEMBER' });
    mockMe.id = caller.id;
    const start = await startGroupCallAction({
      title: 'Closed roster',
      participantUserIds: [invitee.id],
    });
    expect(start.ok).toBe(true);
    if (!start.ok) return;

    mockMe.id = outsider.id;
    mockMe.role = 'MEMBER';
    const join = await joinMeetingAction({ meetingId: start.meetingId });
    expect(join.ok).toBe(false);
  });

  it('creator can always join their own meeting', async () => {
    const caller = await makeUser();
    const invitee = await makeUser();
    mockMe.id = caller.id;
    const start = await startGroupCallAction({
      title: 'Mine',
      participantUserIds: [invitee.id],
    });
    expect(start.ok).toBe(true);
    if (!start.ok) return;

    const join = await joinMeetingAction({ meetingId: start.meetingId });
    expect(join.ok).toBe(true);
  });

  it('refuses to join an ENDED meeting', async () => {
    const caller = await makeUser();
    const invitee = await makeUser();
    mockMe.id = caller.id;
    const start = await startGroupCallAction({
      title: 'Closed',
      participantUserIds: [invitee.id],
    });
    if (!start.ok) return;
    await prisma.meeting.update({
      where: { id: start.meetingId },
      data: { status: 'ENDED' },
    });
    mockMe.id = invitee.id;
    const join = await joinMeetingAction({ meetingId: start.meetingId });
    expect(join.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------
// createMeetingInviteAction
// ---------------------------------------------------------------------
describe('createMeetingInviteAction', () => {
  async function makeMeeting() {
    const caller = await makeUser();
    mockMe.id = caller.id;
    const r = await startGroupCallAction({
      title: 'For invite tests',
      participantUserIds: [(await makeUser()).id],
    });
    if (!r.ok) throw new Error('setup failed');
    return { caller, meetingId: r.meetingId };
  }

  it('creator can mint an invite — token is unique, url contains it', async () => {
    const { meetingId } = await makeMeeting();
    const res = await createMeetingInviteAction({ meetingId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.token.length).toBeGreaterThan(20);
    expect(res.url).toContain(res.token);
    expect(new Date(res.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const row = await prisma.meetingInvite.findUnique({
      where: { token: res.token },
    });
    expect(row).not.toBeNull();
    expect(row?.usedCount).toBe(0);
    expect(row?.revokedAt).toBeNull();
  });

  it('non-creator MEMBER cannot mint an invite', async () => {
    const { meetingId } = await makeMeeting();
    const stranger = await makeUser({ role: 'MEMBER' });
    mockMe.id = stranger.id;
    mockMe.role = 'MEMBER';
    const res = await createMeetingInviteAction({ meetingId });
    expect(res.ok).toBe(false);
  });

  it('ADMIN (not creator) can mint an invite on someone else\'s meeting', async () => {
    const { meetingId } = await makeMeeting();
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    mockMe.role = 'ADMIN';
    const res = await createMeetingInviteAction({ meetingId });
    expect(res.ok).toBe(true);
  });

  it('expiresInHours capped at 168 (7 days)', async () => {
    const { meetingId } = await makeMeeting();
    const res = await createMeetingInviteAction({ meetingId, expiresInHours: 1000 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ms = new Date(res.expiresAt).getTime() - Date.now();
    // ≤ 168h + small slack
    expect(ms).toBeLessThan(168 * 3600_000 + 5_000);
  });

  it('expiresInHours floors at 1 (no zero/negative)', async () => {
    const { meetingId } = await makeMeeting();
    const res = await createMeetingInviteAction({ meetingId, expiresInHours: -5 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ms = new Date(res.expiresAt).getTime() - Date.now();
    expect(ms).toBeGreaterThan(50 * 60_000); // > 50 min
  });

  it('refuses to mint an invite for an ENDED meeting', async () => {
    const { meetingId } = await makeMeeting();
    await prisma.meeting.update({
      where: { id: meetingId },
      data: { status: 'ENDED' },
    });
    const res = await createMeetingInviteAction({ meetingId });
    expect(res.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------
// joinMeetingAsGuestAction
// ---------------------------------------------------------------------
describe('joinMeetingAsGuestAction', () => {
  async function makeInvite(opts: { maxUses?: number | null } = {}) {
    const caller = await makeUser();
    mockMe.id = caller.id;
    const r = await startGroupCallAction({
      title: 'Guest open',
      participantUserIds: [(await makeUser()).id],
    });
    if (!r.ok) throw new Error('setup failed');
    const invite = await createMeetingInviteAction({
      meetingId: r.meetingId,
      maxUses: opts.maxUses,
    });
    if (!invite.ok) throw new Error('invite failed');
    return { caller, meetingId: r.meetingId, token: invite.token };
  }

  it('happy path: guest joins, gets JWT + identity guest:<…>, MeetingParticipant row appears', async () => {
    const { token } = await makeInvite();
    const res = await joinMeetingAsGuestAction({ token, displayName: 'External Bob' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.identity.startsWith('guest:')).toBe(true);
    expect(res.token).toBe('fake-livekit-jwt');
    expect(res.displayName).toBe('External Bob');

    const part = await prisma.meetingParticipant.findFirst({
      where: { livekitIdentity: res.identity },
    });
    expect(part).not.toBeNull();
    expect(part?.userId).toBeNull(); // guest = null user
    expect(part?.displayName).toBe('External Bob');
  });

  it('display name shorter than 2 chars → validation error', async () => {
    const { token } = await makeInvite();
    const res = await joinMeetingAsGuestAction({ token, displayName: 'x' });
    expect(res.ok).toBe(false);
  });

  it('unknown token → "Ссылка недействительна"', async () => {
    const res = await joinMeetingAsGuestAction({
      token: 'totally-fake',
      displayName: 'Bob',
    });
    expect(res).toMatchObject({ ok: false });
  });

  it('revoked invite → refused', async () => {
    const { token } = await makeInvite();
    await prisma.meetingInvite.update({
      where: { token },
      data: { revokedAt: new Date() },
    });
    const res = await joinMeetingAsGuestAction({ token, displayName: 'Bob' });
    expect(res.ok).toBe(false);
  });

  it('expired invite → refused', async () => {
    const { token } = await makeInvite();
    await prisma.meetingInvite.update({
      where: { token },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const res = await joinMeetingAsGuestAction({ token, displayName: 'Bob' });
    expect(res.ok).toBe(false);
  });

  it('maxUses = 1: first guest claims, second gets "Лимит подключений… исчерпан"', async () => {
    const { token } = await makeInvite({ maxUses: 1 });
    const a = await joinMeetingAsGuestAction({ token, displayName: 'First' });
    expect(a.ok).toBe(true);
    const b = await joinMeetingAsGuestAction({ token, displayName: 'Second' });
    expect(b.ok).toBe(false);
  });

  it('usedCount increments per claim', async () => {
    const { token } = await makeInvite();
    await joinMeetingAsGuestAction({ token, displayName: 'A' });
    await joinMeetingAsGuestAction({ token, displayName: 'B' });
    await joinMeetingAsGuestAction({ token, displayName: 'C' });
    const row = await prisma.meetingInvite.findUnique({ where: { token } });
    expect(row?.usedCount).toBe(3);
  });

  it('concurrent guests racing maxUses=2: only 2 succeed', async () => {
    const { token } = await makeInvite({ maxUses: 2 });
    // Fire 5 in parallel.
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        joinMeetingAsGuestAction({ token, displayName: `Race ${i}` }),
      ),
    );
    const okCount = results.filter((r) => r.ok).length;
    expect(okCount).toBe(2);
    const row = await prisma.meetingInvite.findUnique({ where: { token } });
    expect(row?.usedCount).toBe(2);
  });

  it('refuses join when the meeting has ended', async () => {
    const { token, meetingId } = await makeInvite();
    await prisma.meeting.update({
      where: { id: meetingId },
      data: { status: 'ENDED' },
    });
    const res = await joinMeetingAsGuestAction({ token, displayName: 'Late' });
    expect(res.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------
// endMeetingAction (basic sanity — full path covered in messenger-call)
// ---------------------------------------------------------------------
describe('endMeetingAction — ad-hoc group call', () => {
  it('marks meeting as ENDED and sets endedAt', async () => {
    const caller = await makeUser();
    mockMe.id = caller.id;
    const start = await startGroupCallAction({
      title: 'Close it',
      participantUserIds: [(await makeUser()).id],
    });
    if (!start.ok) return;

    const res = await endMeetingAction({ meetingId: start.meetingId });
    expect(res.ok).toBe(true);
    const row = await prisma.meeting.findUnique({
      where: { id: start.meetingId },
    });
    expect(row?.status).toBe('ENDED');
    expect(row?.endedAt).not.toBeNull();
  });
});
