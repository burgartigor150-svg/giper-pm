import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Slice 11 (server bit) — editMessageAction must enforce the same length cap as
 * postMessageAction, so an edit can't smuggle in an over-limit body.
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
import { createChannelAction, postMessageAction, editMessageAction } from '@/actions/messenger';
import { makeUser } from './helpers/factories';

beforeEach(() => {
  mockMe.id = '';
  mockMe.role = 'MEMBER';
});

async function aMessage() {
  const owner = await makeUser();
  mockMe.id = owner.id;
  const ch = await createChannelAction({ name: `e-${Date.now()}-${Math.random()}`, kind: 'PUBLIC' });
  if (!ch.ok || !ch.data) throw new Error('setup');
  const m = await postMessageAction({ channelId: ch.data.id, body: 'оригинал' });
  if (!m.ok || !m.data) throw new Error('msg');
  return m.data.id;
}

describe('editMessageAction length guard', () => {
  it('accepts an edit within the limit', async () => {
    const id = await aMessage();
    const r = await editMessageAction(id, 'новое короткое тело');
    expect(r.ok).toBe(true);
    const row = await prisma.message.findUnique({ where: { id } });
    expect(row?.body).toBe('новое короткое тело');
    expect(row?.editedAt).not.toBeNull();
  });

  it('rejects an over-limit edit (8000 chars max)', async () => {
    const id = await aMessage();
    const r = await editMessageAction(id, 'x'.repeat(8001));
    expect(r).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    // Body unchanged.
    const row = await prisma.message.findUnique({ where: { id } });
    expect(row?.body).toBe('оригинал');
  });

  it('rejects an empty edit', async () => {
    const id = await aMessage();
    const r = await editMessageAction(id, '   ');
    expect(r).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });
});
