import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Slice 4 — membership changes drop a live SYSTEM service message so everyone
 * currently in the channel sees the roster change (SystemEventCard renders
 * MEMBER_CHANGED) instead of only after their own reload.
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
const { publishChatEvent } = vi.hoisted(() => ({
  publishChatEvent: vi.fn((..._args: unknown[]) => Promise.resolve(undefined)),
}));
vi.mock('@/lib/realtime/publishChat', () => ({ publishChatEvent }));

import { prisma } from '@giper/db';
import {
  createChannelAction,
  inviteToChannelAction,
  removeFromChannelAction,
} from '@/actions/messenger';
import { makeUser } from './helpers/factories';

beforeEach(() => {
  mockMe.id = '';
  mockMe.role = 'MEMBER';
  publishChatEvent.mockClear();
});

async function adminChannel() {
  const owner = await makeUser();
  mockMe.id = owner.id;
  const res = await createChannelAction({ name: `mc-${Date.now()}-${Math.random()}`, kind: 'PUBLIC' });
  if (!res.ok || !res.data) throw new Error('setup failed');
  return { owner, channelId: res.data.id };
}

async function systemMessages(channelId: string) {
  return prisma.message.findMany({
    where: { channelId, source: 'SYSTEM', eventKind: 'MEMBER_CHANGED' },
    orderBy: { createdAt: 'asc' },
  });
}

describe('member-change service messages', () => {
  it('invite drops one MEMBER_CHANGED(added) per new member + publishes each', async () => {
    const { channelId } = await adminChannel();
    const u1 = await makeUser({ name: 'Борис' });
    const u2 = await makeUser({ name: 'Вера' });

    const r = await inviteToChannelAction(channelId, [u1.id, u2.id]);
    expect(r).toMatchObject({ ok: true, data: { added: 2 } });

    const sys = await systemMessages(channelId);
    expect(sys).toHaveLength(2);
    const payloads = sys.map((m) => m.eventPayload as { action: string; userName: string });
    expect(payloads).toEqual(
      expect.arrayContaining([
        { action: 'added', userName: 'Борис' },
        { action: 'added', userName: 'Вера' },
      ]),
    );
    // One message.new publish per system message.
    const newEvents = publishChatEvent.mock.calls.filter(
      (c) => (c[0] as { kind: string }).kind === 'message.new',
    );
    expect(newEvents).toHaveLength(2);
  });

  it('re-inviting an existing member is a no-op (no phantom service message)', async () => {
    const { channelId } = await adminChannel();
    const u = await makeUser({ name: 'Глеб' });
    await inviteToChannelAction(channelId, [u.id]);
    publishChatEvent.mockClear();

    const r = await inviteToChannelAction(channelId, [u.id]);
    expect(r).toMatchObject({ ok: true, data: { added: 0 } });
    expect(await systemMessages(channelId)).toHaveLength(1); // still just the first
    expect(publishChatEvent).not.toHaveBeenCalled();
  });

  it('remove drops a MEMBER_CHANGED(removed) message + publishes', async () => {
    const { channelId } = await adminChannel();
    const u = await makeUser({ name: 'Дина' });
    await inviteToChannelAction(channelId, [u.id]);
    publishChatEvent.mockClear();

    const r = await removeFromChannelAction(channelId, u.id);
    expect(r.ok).toBe(true);
    const sys = await systemMessages(channelId);
    const removedMsg = sys.find((m) => (m.eventPayload as { action: string }).action === 'removed');
    expect(removedMsg).toBeTruthy();
    expect((removedMsg!.eventPayload as { userName: string }).userName).toBe('Дина');
    expect(publishChatEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'message.new', channelId, messageId: removedMsg!.id }),
    );
  });

  it('removing a non-member posts no service message', async () => {
    const { channelId } = await adminChannel();
    const stranger = await makeUser();
    publishChatEvent.mockClear();
    const r = await removeFromChannelAction(channelId, stranger.id);
    expect(r.ok).toBe(true);
    expect(await systemMessages(channelId)).toHaveLength(0);
    expect(publishChatEvent).not.toHaveBeenCalled();
  });
});
