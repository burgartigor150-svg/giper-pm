import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration tests for channel-membership server actions:
 *   - createChannelAction (with memberUserIds picker)
 *   - inviteToChannelAction
 *   - removeFromChannelAction
 *   - listChannelMembersAction
 *
 * Mock the requireAuth shim so we can switch identities per test.
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

import { prisma } from '@giper/db';
import {
  createChannelAction,
  inviteToChannelAction,
  removeFromChannelAction,
  listChannelMembersAction,
  postMessageAction,
} from '@/actions/messenger';
import { makeUser } from './helpers/factories';

beforeEach(() => {
  mockMe.id = '';
  mockMe.role = 'MEMBER';
});

describe('createChannelAction — member picker', () => {
  it('PUBLIC channel without invitees is valid (anyone can self-join)', async () => {
    const me = await makeUser();
    mockMe.id = me.id;
    const res = await createChannelAction({
      name: `pub-${Date.now()}`,
      kind: 'PUBLIC',
    });
    expect(res.ok).toBe(true);
    if (res.ok && res.data) {
      const members = await prisma.channelMember.findMany({
        where: { channelId: res.data.id },
      });
      // Creator is the only member, as ADMIN.
      expect(members).toHaveLength(1);
      expect(members[0]!.userId).toBe(me.id);
      expect(members[0]!.role).toBe('ADMIN');
    }
  });

  it('PRIVATE channel without invitees → VALIDATION (no draft channels)', async () => {
    const me = await makeUser();
    mockMe.id = me.id;
    const res = await createChannelAction({
      name: `priv-${Date.now()}`,
      kind: 'PRIVATE',
    });
    expect(res).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
  });

  it('PRIVATE channel with picker → all picked users are MEMBER, creator is ADMIN', async () => {
    const me = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    mockMe.id = me.id;
    const res = await createChannelAction({
      name: `team-${Date.now()}`,
      kind: 'PRIVATE',
      memberUserIds: [a.id, b.id],
    });
    expect(res.ok).toBe(true);
    if (res.ok && res.data) {
      const members = await prisma.channelMember.findMany({
        where: { channelId: res.data.id },
        orderBy: { joinedAt: 'asc' },
      });
      expect(members).toHaveLength(3);
      const meRow = members.find((m) => m.userId === me.id);
      const aRow = members.find((m) => m.userId === a.id);
      const bRow = members.find((m) => m.userId === b.id);
      expect(meRow?.role).toBe('ADMIN');
      expect(aRow?.role).toBe('MEMBER');
      expect(bRow?.role).toBe('MEMBER');
    }
  });

  it('rejects when any picked user id is bogus (atomicity — no partial create)', async () => {
    const me = await makeUser();
    const real = await makeUser();
    mockMe.id = me.id;
    const res = await createChannelAction({
      name: `bad-${Date.now()}`,
      kind: 'PRIVATE',
      memberUserIds: [real.id, '00000000-0000-0000-0000-000000000000'],
    });
    expect(res).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    // Nothing created on the way.
    const ch = await prisma.channel.findFirst({
      where: { createdById: me.id, name: { startsWith: 'bad-' } },
    });
    expect(ch).toBeNull();
  });

  it('inactive users in the picker are rejected', async () => {
    const me = await makeUser();
    const ghost = await makeUser({ isActive: false });
    mockMe.id = me.id;
    const res = await createChannelAction({
      name: `inactive-${Date.now()}`,
      kind: 'PRIVATE',
      memberUserIds: [ghost.id],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
  });

  it("creator id is silently dropped from memberUserIds (no duplicate ADMIN row attempt)", async () => {
    const me = await makeUser();
    const other = await makeUser();
    mockMe.id = me.id;
    const res = await createChannelAction({
      name: `selfpick-${Date.now()}`,
      kind: 'PRIVATE',
      memberUserIds: [me.id, other.id],
    });
    expect(res.ok).toBe(true);
    if (res.ok && res.data) {
      const members = await prisma.channelMember.findMany({
        where: { channelId: res.data.id },
      });
      expect(members).toHaveLength(2);
    }
  });
});

describe('inviteToChannelAction', () => {
  async function makePrivate() {
    const owner = await makeUser();
    const seed = await makeUser();
    mockMe.id = owner.id;
    const res = await createChannelAction({
      name: `c-${Date.now()}-${Math.random()}`,
      kind: 'PRIVATE',
      memberUserIds: [seed.id],
    });
    if (!res.ok || !res.data) throw new Error('setup failed');
    return { owner, seed, channelId: res.data.id };
  }

  it('ADMIN can invite new users (added count reflects actual new rows)', async () => {
    const { owner, channelId } = await makePrivate();
    const newbie = await makeUser();
    mockMe.id = owner.id;
    const r = await inviteToChannelAction(channelId, [newbie.id]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data?.added).toBe(1);
    const row = await prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId: newbie.id } },
    });
    expect(row?.role).toBe('MEMBER');
  });

  it('non-ADMIN member cannot invite → FORBIDDEN', async () => {
    const { seed, channelId } = await makePrivate();
    const newbie = await makeUser();
    mockMe.id = seed.id;
    const r = await inviteToChannelAction(channelId, [newbie.id]);
    expect(r).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('inviting an already-member is a no-op (added=0, role stays)', async () => {
    const { owner, seed, channelId } = await makePrivate();
    // Promote seed to ADMIN to test that re-invite doesn't demote.
    await prisma.channelMember.update({
      where: { channelId_userId: { channelId, userId: seed.id } },
      data: { role: 'ADMIN' },
    });
    mockMe.id = owner.id;
    const r = await inviteToChannelAction(channelId, [seed.id]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data?.added).toBe(0);
    const stillAdmin = await prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId: seed.id } },
    });
    expect(stillAdmin?.role).toBe('ADMIN');
  });

  it('rejects invite in DM channel (VALIDATION)', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    mockMe.id = owner.id;
    const dm = await prisma.channel.create({
      data: {
        kind: 'DM',
        name: 'dm test',
        slug: `dm-${Date.now()}`,
        createdById: owner.id,
        members: {
          create: [
            { userId: owner.id, role: 'ADMIN' },
            { userId: other.id, role: 'MEMBER' },
          ],
        },
      },
    });
    const third = await makeUser();
    const r = await inviteToChannelAction(dm.id, [third.id]);
    expect(r).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('archived channel → GONE', async () => {
    const { owner, channelId } = await makePrivate();
    await prisma.channel.update({
      where: { id: channelId },
      data: { isArchived: true },
    });
    const newbie = await makeUser();
    mockMe.id = owner.id;
    const r = await inviteToChannelAction(channelId, [newbie.id]);
    expect(r).toMatchObject({ ok: false, error: { code: 'GONE' } });
  });
});

describe('removeFromChannelAction', () => {
  async function setup() {
    const owner = await makeUser();
    const member = await makeUser();
    mockMe.id = owner.id;
    const res = await createChannelAction({
      name: `c-${Date.now()}-${Math.random()}`,
      kind: 'PRIVATE',
      memberUserIds: [member.id],
    });
    if (!res.ok || !res.data) throw new Error('setup failed');
    return { owner, member, channelId: res.data.id };
  }

  it('ADMIN can remove a regular member', async () => {
    const { owner, member, channelId } = await setup();
    mockMe.id = owner.id;
    const r = await removeFromChannelAction(channelId, member.id);
    expect(r.ok).toBe(true);
    const row = await prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId: member.id } },
    });
    expect(row).toBeNull();
  });

  it('cannot remove the creator (sticky)', async () => {
    const { owner, member, channelId } = await setup();
    // member tries to remove owner — but they're not admin anyway,
    // so this fails on FORBIDDEN. Make member admin first.
    await prisma.channelMember.update({
      where: { channelId_userId: { channelId, userId: member.id } },
      data: { role: 'ADMIN' },
    });
    mockMe.id = member.id;
    const r = await removeFromChannelAction(channelId, owner.id);
    expect(r).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('non-admin member cannot remove anyone → FORBIDDEN', async () => {
    const { member, channelId } = await setup();
    const third = await makeUser();
    await prisma.channelMember.create({
      data: { channelId, userId: third.id, role: 'MEMBER' },
    });
    mockMe.id = member.id;
    const r = await removeFromChannelAction(channelId, third.id);
    expect(r).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });
});

describe('listChannelMembersAction', () => {
  it('any member can list; admin flag set correctly', async () => {
    const owner = await makeUser();
    const m = await makeUser();
    mockMe.id = owner.id;
    const res = await createChannelAction({
      name: `c-${Date.now()}`,
      kind: 'PRIVATE',
      memberUserIds: [m.id],
    });
    if (!res.ok || !res.data) throw new Error('setup failed');
    const channelId = res.data.id;
    // Owner sees canManage=true.
    let r = await listChannelMembersAction(channelId);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.canManage).toBe(true);
      expect(r.data.members).toHaveLength(2);
      expect(r.data.members.find((x) => x.id === owner.id)?.isCreator).toBe(true);
    }
    // Regular member sees canManage=false.
    mockMe.id = m.id;
    r = await listChannelMembersAction(channelId);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.canManage).toBe(false);
  });

  it('non-member → FORBIDDEN', async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    mockMe.id = owner.id;
    const res = await createChannelAction({
      name: `c-${Date.now()}`,
      kind: 'PRIVATE',
      memberUserIds: [(await makeUser()).id],
    });
    if (!res.ok || !res.data) throw new Error('setup failed');
    mockMe.id = stranger.id;
    const r = await listChannelMembersAction(res.data.id);
    expect(r).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });
});

describe('BROADCAST channels', () => {
  it('createChannelAction seeds invitees as ADMIN (co-authors)', async () => {
    const owner = await makeUser();
    const coAuthor = await makeUser();
    mockMe.id = owner.id;
    const res = await createChannelAction({
      name: `bc-${Date.now()}`,
      kind: 'BROADCAST',
      memberUserIds: [coAuthor.id],
    });
    expect(res.ok).toBe(true);
    if (!res.ok || !res.data) return;
    const member = await prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId: res.data.id, userId: coAuthor.id } },
    });
    expect(member?.role).toBe('ADMIN');
  });

  it('postMessageAction in BROADCAST: non-admin reader → FORBIDDEN', async () => {
    const owner = await makeUser();
    const reader = await makeUser();
    mockMe.id = owner.id;
    const res = await createChannelAction({
      name: `bc-${Date.now()}`,
      kind: 'BROADCAST',
    });
    if (!res.ok || !res.data) throw new Error('setup');
    // Subscribe reader as MEMBER (not admin).
    await prisma.channelMember.create({
      data: { channelId: res.data.id, userId: reader.id, role: 'MEMBER' },
    });
    mockMe.id = reader.id;
    const r = await postMessageAction({
      channelId: res.data.id,
      body: 'hi',
    });
    expect(r).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('postMessageAction in BROADCAST: admin author → ok', async () => {
    const owner = await makeUser();
    mockMe.id = owner.id;
    const res = await createChannelAction({
      name: `bc-${Date.now()}`,
      kind: 'BROADCAST',
    });
    if (!res.ok || !res.data) throw new Error('setup');
    const r = await postMessageAction({
      channelId: res.data.id,
      body: 'announcement',
    });
    expect(r.ok).toBe(true);
  });

  it('postMessageAction in BROADCAST: non-member also FORBIDDEN (no lazy-join)', async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    mockMe.id = owner.id;
    const res = await createChannelAction({
      name: `bc-${Date.now()}`,
      kind: 'BROADCAST',
    });
    if (!res.ok || !res.data) throw new Error('setup');
    mockMe.id = stranger.id;
    const r = await postMessageAction({
      channelId: res.data.id,
      body: 'spam',
    });
    expect(r).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    // Confirm we did NOT silently auto-join the user (only PUBLIC does that).
    const member = await prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId: res.data.id, userId: stranger.id } },
    });
    expect(member).toBeNull();
  });
});
