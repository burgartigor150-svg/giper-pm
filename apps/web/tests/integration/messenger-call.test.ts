import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * "Позвонить" in chat — Phase A. We mock LiveKit/Redis dependencies
 * the same way meetings.test.ts does (the real SFU is integration
 * plumbing, not part of the unit boundary we're verifying here).
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

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('ioredis', () => ({
  Redis: class FakeRedis {
    publish() { return Promise.resolve(1); }
  },
}));
vi.mock('@giper/integrations', () => ({
  buildTurnCredentials: () => [],
  livekitPublicUrl: () => 'wss://lk.test',
  mintAccessToken: async () => 'tok',
  stopEgress: async () => undefined,
}));
vi.mock('@/lib/realtime/publishChat', () => ({
  publishChatEvent: vi.fn(async () => undefined),
}));

import { prisma } from '@giper/db';
import {
  startCallInChannelAction,
  endMeetingAction,
} from '@/actions/meetings';
import { createChannelAction } from '@/actions/messenger';
import { makeUser } from './helpers/factories';

beforeEach(() => {
  mockMe.id = '';
  mockMe.role = 'MEMBER';
});

async function setupChannel(kind: 'PUBLIC' | 'PRIVATE' = 'PUBLIC') {
  const owner = await makeUser();
  mockMe.id = owner.id;
  const memberA = await makeUser();
  const r = await createChannelAction({
    name: `call-${Date.now()}-${Math.random()}`,
    kind,
    memberUserIds: kind === 'PRIVATE' ? [memberA.id] : [],
  });
  if (!r.ok || !r.data) throw new Error('setup failed');
  return { owner, memberA, channelId: r.data.id };
}

describe('startCallInChannelAction', () => {
  it('creates a Meeting with channelId + livekitRoomName + CALL_STARTED system message', async () => {
    const { owner, channelId } = await setupChannel();
    mockMe.id = owner.id;
    const r = await startCallInChannelAction({ channelId });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const m = await prisma.meeting.findUnique({ where: { id: r.meetingId } });
      expect(m?.channelId).toBe(channelId);
      expect(m?.livekitRoomName?.startsWith('m_')).toBe(true);
      expect(m?.status).toBe('PLANNED');
      const sys = await prisma.message.findFirst({
        where: { channelId, source: 'SYSTEM', eventKind: 'CALL_STARTED' },
      });
      expect(sys).not.toBeNull();
      const payload = sys?.eventPayload as { meetingId?: string } | null;
      expect(payload?.meetingId).toBe(r.meetingId);
    }
  });

  it('reusing an active call: second start returns the SAME meeting (no duplicate room)', async () => {
    const { owner, channelId } = await setupChannel();
    mockMe.id = owner.id;
    const a = await startCallInChannelAction({ channelId });
    const b = await startCallInChannelAction({ channelId });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(b.meetingId).toBe(a.meetingId);
      const sysCount = await prisma.message.count({
        where: { channelId, eventKind: 'CALL_STARTED' },
      });
      // Second call should NOT post another CALL_STARTED card.
      expect(sysCount).toBe(1);
    }
  });

  it('non-member of PRIVATE channel → cannot start a call', async () => {
    const { channelId } = await setupChannel('PRIVATE');
    const stranger = await makeUser();
    mockMe.id = stranger.id;
    const r = await startCallInChannelAction({ channelId });
    expect(r.ok).toBe(false);
  });

  it('PUBLIC channel: any active user can start a call (no-op for non-member is membership-on-post elsewhere)', async () => {
    // Note: startCall doesn't lazy-join — the user must already be
    // able to post. For PUBLIC that's true for anyone, so this
    // succeeds for a fresh user.
    const { channelId } = await setupChannel('PUBLIC');
    const stranger = await makeUser();
    mockMe.id = stranger.id;
    const r = await startCallInChannelAction({ channelId });
    expect(r.ok).toBe(true);
  });

  it('DM title is set to "Звонок с <other>"', async () => {
    const me = await makeUser();
    const other = await makeUser({ name: 'Friend' });
    mockMe.id = me.id;
    const dm = await prisma.channel.create({
      data: {
        kind: 'DM',
        slug: `dm-${Date.now()}-${Math.random()}`,
        name: 'Friend',
        createdById: me.id,
        members: {
          create: [
            { userId: me.id, role: 'MEMBER' },
            { userId: other.id, role: 'MEMBER' },
          ],
        },
      },
    });
    const r = await startCallInChannelAction({ channelId: dm.id });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const m = await prisma.meeting.findUnique({ where: { id: r.meetingId } });
      expect(m?.title).toBe('Звонок с Friend');
    }
  });
});

describe('endMeetingAction — chat-originated calls', () => {
  it('posts a CALL_ENDED system message with duration when the meeting had a channelId', async () => {
    const { owner, channelId } = await setupChannel();
    mockMe.id = owner.id;
    const started = await startCallInChannelAction({ channelId });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    // Pretend the call ran for 90 seconds.
    await prisma.meeting.update({
      where: { id: started.meetingId },
      data: { startedAt: new Date(Date.now() - 90_000), status: 'ACTIVE' },
    });
    const r = await endMeetingAction({ meetingId: started.meetingId });
    expect(r.ok).toBe(true);
    const sys = await prisma.message.findFirst({
      where: { channelId, eventKind: 'CALL_ENDED' },
    });
    expect(sys).not.toBeNull();
    const payload = sys?.eventPayload as
      | { meetingId?: string; durationSec?: number | null }
      | null;
    expect(payload?.meetingId).toBe(started.meetingId);
    expect(payload?.durationSec).toBeGreaterThanOrEqual(89);
    expect(payload?.durationSec).toBeLessThanOrEqual(91);
  });

  it('does not post CALL_ENDED for project-only (no channelId) meetings', async () => {
    // Create a meeting without channelId — simulates the old
    // /meetings flow.
    const u = await makeUser();
    mockMe.id = u.id;
    const m = await prisma.meeting.create({
      data: {
        title: 'Project meeting',
        kind: 'VIDEO_LIVEKIT',
        status: 'ACTIVE',
        createdById: u.id,
        startedAt: new Date(Date.now() - 60_000),
      },
    });
    const r = await endMeetingAction({ meetingId: m.id });
    expect(r.ok).toBe(true);
    const anySystemMsg = await prisma.message.findFirst({
      where: { eventKind: 'CALL_ENDED' },
    });
    // Test runs in an isolated DB-reset world; no CALL_ENDED rows
    // for project-only meetings.
    expect(anySystemMsg).toBeNull();
  });
});
