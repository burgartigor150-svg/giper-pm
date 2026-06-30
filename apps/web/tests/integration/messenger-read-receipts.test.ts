import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Slice 10c (server bit) — loadOtherMemberReads feeds the read-receipt ticks:
 * returns other members' lastReadAt (ms), excluding the caller and members who
 * have never read.
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
import { createChannelAction, inviteToChannelAction } from '@/actions/messenger';
import { loadOtherMemberReads } from '@/lib/messenger/queries';
import { makeUser } from './helpers/factories';

beforeEach(() => {
  mockMe.id = '';
  mockMe.role = 'MEMBER';
});

describe('loadOtherMemberReads', () => {
  it('returns other members read watermarks, excluding self and never-read', async () => {
    const owner = await makeUser();
    mockMe.id = owner.id;
    const reader = await makeUser();
    const lurker = await makeUser();
    const ch = await createChannelAction({ name: `rr-${Date.now()}-${Math.random()}`, kind: 'PUBLIC' });
    if (!ch.ok || !ch.data) throw new Error('setup');
    await inviteToChannelAction(ch.data.id, [reader.id, lurker.id]);

    const readAt = new Date('2026-06-30T12:00:00Z');
    await prisma.channelMember.update({
      where: { channelId_userId: { channelId: ch.data.id, userId: reader.id } },
      data: { lastReadAt: readAt },
    });
    // owner also has a lastReadAt — must be excluded (it's "self").
    await prisma.channelMember.update({
      where: { channelId_userId: { channelId: ch.data.id, userId: owner.id } },
      data: { lastReadAt: new Date() },
    });

    const reads = await loadOtherMemberReads(ch.data.id, owner.id);
    expect(reads[reader.id]).toBe(readAt.getTime());
    expect(reads[lurker.id]).toBeUndefined(); // never read
    expect(reads[owner.id]).toBeUndefined(); // self excluded
  });
});
