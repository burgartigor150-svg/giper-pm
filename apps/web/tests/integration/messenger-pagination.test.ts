import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Slice 8 (server bit) — loadOlderMessagesAction: cursor pagination up the
 * channel history via the `before` cursor, returning chronological pages +
 * a hasMore flag.
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

import { prisma } from '@giper/db';
import { createChannelAction, loadOlderMessagesAction } from '@/actions/messenger';
import { makeUser } from './helpers/factories';

beforeEach(() => {
  mockMe.id = '';
  mockMe.role = 'MEMBER';
});

async function channelWith(n: number) {
  const owner = await makeUser();
  mockMe.id = owner.id;
  const ch = await createChannelAction({ name: `pg-${Date.now()}-${Math.random()}`, kind: 'PUBLIC' });
  if (!ch.ok || !ch.data) throw new Error('setup');
  const base = Date.parse('2026-06-01T00:00:00Z');
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const m = await prisma.message.create({
      data: {
        channelId: ch.data.id,
        authorId: owner.id,
        body: `m${i + 1}`,
        createdAt: new Date(base + i * 60_000), // 1 min apart, strictly increasing
      },
      select: { id: true },
    });
    ids.push(m.id);
  }
  return { channelId: ch.data.id, ids, base };
}

describe('loadOlderMessagesAction', () => {
  it('paginates older history in chronological order with hasMore', async () => {
    const { channelId, base } = await channelWith(5); // m1..m5 oldest→newest

    // First page: 2 newest, before = far future.
    const p1 = await loadOlderMessagesAction({ channelId, before: '2999-01-01T00:00:00Z', limit: 2 });
    expect(p1?.messages.map((m) => m.body)).toEqual(['m4', 'm5']); // chronological
    expect(p1?.hasMore).toBe(true);

    // Next page: before = m4's createdAt (base + 3min) → m2, m3.
    const beforeM4 = new Date(base + 3 * 60_000).toISOString();
    const p2 = await loadOlderMessagesAction({ channelId, before: beforeM4, limit: 2 });
    expect(p2?.messages.map((m) => m.body)).toEqual(['m2', 'm3']);
    expect(p2?.hasMore).toBe(true);

    // Last page: before = m2's createdAt (base + 1min) → just m1, no more.
    const beforeM2 = new Date(base + 1 * 60_000).toISOString();
    const p3 = await loadOlderMessagesAction({ channelId, before: beforeM2, limit: 2 });
    expect(p3?.messages.map((m) => m.body)).toEqual(['m1']);
    expect(p3?.hasMore).toBe(false);
  });

  it('returns null for a channel the caller cannot read', async () => {
    const owner = await makeUser();
    mockMe.id = owner.id;
    const peer = await makeUser();
    const ch = await createChannelAction({ name: `pgp-${Date.now()}-${Math.random()}`, kind: 'PRIVATE', memberUserIds: [peer.id] });
    if (!ch.ok || !ch.data) throw new Error('setup');
    const stranger = await makeUser();
    mockMe.id = stranger.id;
    const r = await loadOlderMessagesAction({ channelId: ch.data.id, before: '2999-01-01T00:00:00Z' });
    expect(r).toBeNull();
  });

  it('handles an invalid before cursor gracefully', async () => {
    const { channelId } = await channelWith(1);
    const r = await loadOlderMessagesAction({ channelId, before: 'not-a-date' });
    expect(r).toEqual({ messages: [], mentionedUsers: [], taskPreviews: [], hasMore: false });
  });
});
