import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  createChannelInviteAction,
  listChannelInvitesAction,
  revokeChannelInviteAction,
  previewChannelInviteAction,
  acceptChannelInviteAction,
} from '@/actions/messenger';
import { makeUser } from './helpers/factories';

beforeEach(() => {
  mockMe.id = '';
  mockMe.role = 'MEMBER';
});

async function makePrivateChannelWithAdmin(adminId: string) {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return prisma.channel.create({
    data: {
      kind: 'PRIVATE',
      name: `Priv ${tag}`,
      slug: `priv-${tag}`,
      createdById: adminId,
      members: { create: [{ userId: adminId, role: 'ADMIN' }] },
    },
  });
}

describe('createChannelInviteAction', () => {
  it('admin can create invite for PRIVATE channel', async () => {
    const admin = await makeUser();
    mockMe.id = admin.id;
    const ch = await makePrivateChannelWithAdmin(admin.id);

    const r = await createChannelInviteAction(ch.id);
    expect(r.ok).toBe(true);
    if (r.ok && r.data) {
      expect(r.data.token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(r.data.token.length).toBeGreaterThanOrEqual(20);
    }
  });

  it('refuses for PUBLIC channel', async () => {
    const admin = await makeUser();
    mockMe.id = admin.id;
    const ch = await prisma.channel.create({
      data: {
        kind: 'PUBLIC',
        name: 'pub',
        slug: `pub-${Date.now()}`,
        createdById: admin.id,
        members: { create: [{ userId: admin.id, role: 'ADMIN' }] },
      },
    });
    const r = await createChannelInviteAction(ch.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('VALIDATION');
  });

  it('refuses when caller is not admin', async () => {
    const admin = await makeUser();
    const other = await makeUser();
    const ch = await makePrivateChannelWithAdmin(admin.id);
    await prisma.channelMember.create({
      data: { channelId: ch.id, userId: other.id, role: 'MEMBER' },
    });
    mockMe.id = other.id;
    const r = await createChannelInviteAction(ch.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN');
  });

  it('refuses when channel is archived', async () => {
    const admin = await makeUser();
    mockMe.id = admin.id;
    const ch = await makePrivateChannelWithAdmin(admin.id);
    await prisma.channel.update({ where: { id: ch.id }, data: { isArchived: true } });
    const r = await createChannelInviteAction(ch.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('GONE');
  });

  it('rejects negative maxUses', async () => {
    const admin = await makeUser();
    mockMe.id = admin.id;
    const ch = await makePrivateChannelWithAdmin(admin.id);
    const r = await createChannelInviteAction(ch.id, { maxUses: 0 });
    expect(r.ok).toBe(false);
  });

  it('rejects past expiresAt', async () => {
    const admin = await makeUser();
    mockMe.id = admin.id;
    const ch = await makePrivateChannelWithAdmin(admin.id);
    const r = await createChannelInviteAction(ch.id, { expiresAt: new Date(Date.now() - 60_000) });
    expect(r.ok).toBe(false);
  });
});

describe('listChannelInvitesAction', () => {
  it('lists invites for admin, newest first', async () => {
    const admin = await makeUser();
    mockMe.id = admin.id;
    const ch = await makePrivateChannelWithAdmin(admin.id);
    const a = await createChannelInviteAction(ch.id);
    await new Promise((r) => setTimeout(r, 5));
    const b = await createChannelInviteAction(ch.id);
    const r = await listChannelInvitesAction(ch.id);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.length).toBe(2);
      if (a.ok && b.ok && a.data && b.data) {
        expect(r.data[0]?.id).toBe(b.data.id);
        expect(r.data[1]?.id).toBe(a.data.id);
      }
    }
  });

  it('refuses for non-admin', async () => {
    const admin = await makeUser();
    const other = await makeUser();
    const ch = await makePrivateChannelWithAdmin(admin.id);
    await prisma.channelMember.create({
      data: { channelId: ch.id, userId: other.id, role: 'MEMBER' },
    });
    mockMe.id = other.id;
    const r = await listChannelInvitesAction(ch.id);
    expect(r.ok).toBe(false);
  });
});

describe('revokeChannelInviteAction', () => {
  it('marks invite as revoked, idempotent on second call', async () => {
    const admin = await makeUser();
    mockMe.id = admin.id;
    const ch = await makePrivateChannelWithAdmin(admin.id);
    const created = await createChannelInviteAction(ch.id);
    expect(created.ok).toBe(true);
    if (!created.ok || !created.data) return;

    const r1 = await revokeChannelInviteAction(created.data.id);
    expect(r1.ok).toBe(true);

    const row = await prisma.channelInvite.findUnique({ where: { id: created.data.id } });
    expect(row?.revokedAt).not.toBeNull();
    const firstRevoke = row?.revokedAt;

    const r2 = await revokeChannelInviteAction(created.data.id);
    expect(r2.ok).toBe(true);
    const row2 = await prisma.channelInvite.findUnique({ where: { id: created.data.id } });
    // Should NOT bump revokedAt on second call.
    expect(row2?.revokedAt?.getTime()).toBe(firstRevoke?.getTime());
  });
});

describe('previewChannelInviteAction', () => {
  it('returns isValid=true for a fresh invite', async () => {
    const admin = await makeUser();
    mockMe.id = admin.id;
    const ch = await makePrivateChannelWithAdmin(admin.id);
    const created = await createChannelInviteAction(ch.id);
    if (!created.ok || !created.data) throw new Error('setup');
    const r = await previewChannelInviteAction(created.data.token);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.isValid).toBe(true);
      expect(r.data.channelKind).toBe('PRIVATE');
      expect(r.data.memberCount).toBe(1);
    }
  });

  it('returns isValid=false when revoked', async () => {
    const admin = await makeUser();
    mockMe.id = admin.id;
    const ch = await makePrivateChannelWithAdmin(admin.id);
    const created = await createChannelInviteAction(ch.id);
    if (!created.ok || !created.data) throw new Error('setup');
    await revokeChannelInviteAction(created.data.id);
    const r = await previewChannelInviteAction(created.data.token);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.isValid).toBe(false);
  });

  it('NOT_FOUND for unknown token', async () => {
    const admin = await makeUser();
    mockMe.id = admin.id;
    const r = await previewChannelInviteAction('does-not-exist');
    expect(r.ok).toBe(false);
  });
});

describe('acceptChannelInviteAction', () => {
  it('joins caller as MEMBER and increments useCount', async () => {
    const admin = await makeUser();
    const joiner = await makeUser();
    mockMe.id = admin.id;
    const ch = await makePrivateChannelWithAdmin(admin.id);
    const created = await createChannelInviteAction(ch.id);
    if (!created.ok || !created.data) throw new Error('setup');

    mockMe.id = joiner.id;
    const r = await acceptChannelInviteAction(created.data.token);
    expect(r.ok).toBe(true);

    const mem = await prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId: ch.id, userId: joiner.id } },
    });
    expect(mem?.role).toBe('MEMBER');

    const inv = await prisma.channelInvite.findUnique({ where: { id: created.data.id } });
    expect(inv?.useCount).toBe(1);
  });

  it('second accept by same user is no-op success (idempotent)', async () => {
    const admin = await makeUser();
    const joiner = await makeUser();
    mockMe.id = admin.id;
    const ch = await makePrivateChannelWithAdmin(admin.id);
    const created = await createChannelInviteAction(ch.id);
    if (!created.ok || !created.data) throw new Error('setup');

    mockMe.id = joiner.id;
    await acceptChannelInviteAction(created.data.token);
    const r = await acceptChannelInviteAction(created.data.token);
    expect(r.ok).toBe(true);

    const inv = await prisma.channelInvite.findUnique({ where: { id: created.data.id } });
    // Should not double-increment for the same user.
    expect(inv?.useCount).toBe(1);
  });

  it('refuses when revoked', async () => {
    const admin = await makeUser();
    const joiner = await makeUser();
    mockMe.id = admin.id;
    const ch = await makePrivateChannelWithAdmin(admin.id);
    const created = await createChannelInviteAction(ch.id);
    if (!created.ok || !created.data) throw new Error('setup');
    await revokeChannelInviteAction(created.data.id);

    mockMe.id = joiner.id;
    const r = await acceptChannelInviteAction(created.data.token);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('GONE');
  });

  it('refuses when expired', async () => {
    const admin = await makeUser();
    const joiner = await makeUser();
    mockMe.id = admin.id;
    const ch = await makePrivateChannelWithAdmin(admin.id);
    // create in the future then rewrite to past via raw update so the
    // create-time guard doesn't reject us.
    const created = await createChannelInviteAction(ch.id, {
      expiresAt: new Date(Date.now() + 60_000),
    });
    if (!created.ok || !created.data) throw new Error('setup');
    await prisma.channelInvite.update({
      where: { id: created.data.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    mockMe.id = joiner.id;
    const r = await acceptChannelInviteAction(created.data.token);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('GONE');
  });

  it('honours maxUses limit (atomic)', async () => {
    const admin = await makeUser();
    const u1 = await makeUser();
    const u2 = await makeUser();
    mockMe.id = admin.id;
    const ch = await makePrivateChannelWithAdmin(admin.id);
    const created = await createChannelInviteAction(ch.id, { maxUses: 1 });
    if (!created.ok || !created.data) throw new Error('setup');

    mockMe.id = u1.id;
    const r1 = await acceptChannelInviteAction(created.data.token);
    expect(r1.ok).toBe(true);

    mockMe.id = u2.id;
    const r2 = await acceptChannelInviteAction(created.data.token);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.code).toBe('GONE');
  });

  it('NOT_FOUND on unknown token', async () => {
    const admin = await makeUser();
    mockMe.id = admin.id;
    const r = await acceptChannelInviteAction('not-real-token');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
  });
});
