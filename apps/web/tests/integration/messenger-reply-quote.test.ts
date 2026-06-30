import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Slice 9 — inline reply quote (Message.replyToId, distinct from thread
 * parentId). postMessageAction validates the quoted message is in the same
 * channel; loadChannelMessages returns the quote preview; deleting the quoted
 * message leaves the reply intact (onDelete: SetNull).
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
vi.mock('@/lib/realtime/publishChat', () => ({ publishChatEvent: vi.fn(async () => undefined) }));
vi.mock('@/lib/push/sendPush', () => ({ sendPushToUsers: vi.fn(async () => undefined) }));

import { prisma } from '@giper/db';
import { createChannelAction, postMessageAction } from '@/actions/messenger';
import { loadChannelMessages } from '@/lib/messenger/queries';
import { makeUser } from './helpers/factories';

beforeEach(() => {
  mockMe.id = '';
  mockMe.role = 'MEMBER';
});

async function channelWithMessage() {
  const owner = await makeUser({ name: 'Автор' });
  mockMe.id = owner.id;
  const ch = await createChannelAction({ name: `rq-${Date.now()}-${Math.random()}`, kind: 'PUBLIC' });
  if (!ch.ok || !ch.data) throw new Error('setup');
  const root = await postMessageAction({ channelId: ch.data.id, body: 'оригинальное сообщение' });
  if (!root.ok || !root.data) throw new Error('root');
  return { ownerId: owner.id, channelId: ch.data.id, rootId: root.data.id };
}

describe('inline reply quote', () => {
  it('stores replyToId and loadChannelMessages returns the quote preview', async () => {
    const { channelId, rootId } = await channelWithMessage();
    const reply = await postMessageAction({ channelId, body: 'это ответ', replyToId: rootId });
    expect(reply.ok).toBe(true);

    const loaded = await loadChannelMessages(channelId, mockMe.id);
    const replyRow = loaded?.messages.find((m) => m.id === (reply.ok ? reply.data!.id : ''));
    expect(replyRow?.replyToId).toBe(rootId);
    expect(replyRow?.replyTo?.body).toBe('оригинальное сообщение');
    expect(replyRow?.replyTo?.author.name).toBe('Автор');
  });

  it('rejects a replyToId from another channel', async () => {
    const { rootId } = await channelWithMessage();
    // second channel by same user
    const ch2 = await createChannelAction({ name: `rq2-${Date.now()}-${Math.random()}`, kind: 'PUBLIC' });
    if (!ch2.ok || !ch2.data) throw new Error('setup2');
    const r = await postMessageAction({ channelId: ch2.data.id, body: 'cross', replyToId: rootId });
    expect(r).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('rejects a non-existent replyToId', async () => {
    const { channelId } = await channelWithMessage();
    const r = await postMessageAction({ channelId, body: 'x', replyToId: 'nope-does-not-exist' });
    expect(r).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('keeps the reply when the quoted message is deleted (SetNull)', async () => {
    const { channelId, rootId } = await channelWithMessage();
    const reply = await postMessageAction({ channelId, body: 'ответ на удаляемое', replyToId: rootId });
    if (!reply.ok || !reply.data) throw new Error('reply');
    await prisma.message.delete({ where: { id: rootId } });
    const row = await prisma.message.findUnique({ where: { id: reply.data.id } });
    expect(row).not.toBeNull();
    expect(row?.replyToId).toBeNull();
  });
});
