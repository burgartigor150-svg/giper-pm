import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Slice 5 — unread badges + message notifications.
 *   - listMyChannels reports a per-channel unreadCount (others' messages
 *     after lastReadAt; own/SYSTEM/deleted excluded), cleared by markRead.
 *   - DM/GROUP_DM messages create CHAT_DM notifications for the peers;
 *     @mentions create CHAT_MENTION; plain channel messages notify nobody;
 *     muted members are skipped.
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
vi.mock('@/lib/realtime/publishChat', () => ({
  publishChatEvent: vi.fn(async () => undefined),
}));
const { sendPushToUsers } = vi.hoisted(() => ({
  sendPushToUsers: vi.fn(async () => undefined),
}));
vi.mock('@/lib/push/sendPush', () => ({ sendPushToUsers }));

import { prisma } from '@giper/db';
import {
  createChannelAction,
  inviteToChannelAction,
  postMessageAction,
  getOrCreateDmAction,
  listMyChannels,
  markChannelReadAction,
  setChannelMutedAction,
} from '@/actions/messenger';
import { makeUser } from './helpers/factories';

beforeEach(() => {
  mockMe.id = '';
  mockMe.role = 'MEMBER';
  sendPushToUsers.mockClear();
});

function as(userId: string) {
  mockMe.id = userId;
}

async function notificationsFor(userId: string, kind?: string) {
  return prisma.notification.findMany({
    where: { userId, ...(kind ? { kind: kind as never } : {}) },
  });
}

async function unreadOf(channelId: string): Promise<number> {
  const { memberChannels } = await listMyChannels();
  const c = memberChannels.find((m) => m.id === channelId);
  return c?.unreadCount ?? -1;
}

describe('unread counts', () => {
  it('counts others’ messages, ignores own, clears on markRead', async () => {
    const me = await makeUser();
    const peer = await makeUser();
    as(me.id);
    const ch = await createChannelAction({ name: `u-${Date.now()}-${Math.random()}`, kind: 'PUBLIC' });
    if (!ch.ok || !ch.data) throw new Error('setup');
    const channelId = ch.data.id;
    await inviteToChannelAction(channelId, [peer.id]);

    // peer posts 2, me posts 1
    as(peer.id);
    await postMessageAction({ channelId, body: 'hi 1' });
    await postMessageAction({ channelId, body: 'hi 2' });
    as(me.id);
    await postMessageAction({ channelId, body: 'my own' });

    expect(await unreadOf(channelId)).toBe(2); // my own + the 2 member-add SYSTEM cards excluded

    await markChannelReadAction(channelId);
    expect(await unreadOf(channelId)).toBe(0);
  });
});

describe('message notifications', () => {
  it('DM message creates a CHAT_DM notification for the peer, none for the author', async () => {
    const me = await makeUser();
    const peer = await makeUser({ name: 'Пётр' });
    as(me.id);
    const dm = await getOrCreateDmAction(peer.id);
    if (!dm.ok || !dm.data) throw new Error('dm setup');

    await postMessageAction({ channelId: dm.data.id, body: 'привет' });

    expect(await notificationsFor(peer.id, 'CHAT_DM')).toHaveLength(1);
    expect(await notificationsFor(me.id, 'CHAT_DM')).toHaveLength(0);
    expect(sendPushToUsers).toHaveBeenCalled();
  });

  it('@mention creates a CHAT_MENTION notification', async () => {
    const me = await makeUser();
    const peer = await makeUser();
    as(me.id);
    const ch = await createChannelAction({ name: `m-${Date.now()}-${Math.random()}`, kind: 'PUBLIC' });
    if (!ch.ok || !ch.data) throw new Error('setup');
    await inviteToChannelAction(ch.data.id, [peer.id]);
    await postMessageAction({ channelId: ch.data.id, body: `привет @${peer.id} !` });

    expect(await notificationsFor(peer.id, 'CHAT_MENTION')).toHaveLength(1);
  });

  it('plain channel message (no mention) notifies nobody', async () => {
    const me = await makeUser();
    const peer = await makeUser();
    as(me.id);
    const ch = await createChannelAction({ name: `p-${Date.now()}-${Math.random()}`, kind: 'PUBLIC' });
    if (!ch.ok || !ch.data) throw new Error('setup');
    await inviteToChannelAction(ch.data.id, [peer.id]);
    sendPushToUsers.mockClear();
    await postMessageAction({ channelId: ch.data.id, body: 'обычное сообщение' });

    expect(await notificationsFor(peer.id)).toHaveLength(0);
    expect(sendPushToUsers).not.toHaveBeenCalled();
  });

  it('muted peer gets neither a DM notification nor push', async () => {
    const me = await makeUser();
    const peer = await makeUser();
    as(me.id);
    const dm = await getOrCreateDmAction(peer.id);
    if (!dm.ok || !dm.data) throw new Error('dm setup');
    as(peer.id);
    await setChannelMutedAction(dm.data.id, true);
    as(me.id);
    sendPushToUsers.mockClear();
    await postMessageAction({ channelId: dm.data.id, body: 'тук-тук' });

    expect(await notificationsFor(peer.id, 'CHAT_DM')).toHaveLength(0);
    expect(sendPushToUsers).not.toHaveBeenCalled();
  });
});
