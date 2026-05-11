import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import { resolveChannelAccess, ensureMembership } from '@/lib/messenger/access';
import { makeUser } from './helpers/factories';

/**
 * Messenger access matrix. Source under test:
 *   apps/web/lib/messenger/access.ts
 *
 * Visibility rules:
 *   - PUBLIC      → read/post for anyone (auto-join on post)
 *   - PRIVATE     → ChannelMember required for read and post
 *   - DM/GROUP_DM → ChannelMember required for read and post
 *   - Archived: nobody can post; non-members can't read anymore
 */

let chSeq = 0;
async function makeChannel(args: {
  kind: 'PUBLIC' | 'PRIVATE' | 'DM' | 'GROUP_DM';
  isArchived?: boolean;
  createdById: string;
  slug?: string;
}) {
  // `name` is required by the schema (DM/GROUP_DM still use it for
  // display in the sidebar; the slug is the unique key).
  const tag = `${Date.now()}-${++chSeq}`;
  return prisma.channel.create({
    data: {
      kind: args.kind,
      isArchived: args.isArchived ?? false,
      createdById: args.createdById,
      name: `Channel ${tag}`,
      slug: args.slug ?? `ch-${tag}`,
    },
  });
}

describe('resolveChannelAccess — PUBLIC', () => {
  it('non-member can read and post; live channel', async () => {
    const owner = await makeUser();
    const someone = await makeUser();
    const ch = await makeChannel({ kind: 'PUBLIC', createdById: owner.id });
    const a = await resolveChannelAccess(ch.id, someone.id);
    expect(a).toMatchObject({ kind: 'PUBLIC', canRead: true, canPost: true, isMember: false });
  });

  it('archived → non-member cannot read, nobody can post', async () => {
    const owner = await makeUser();
    const someone = await makeUser();
    const ch = await makeChannel({ kind: 'PUBLIC', createdById: owner.id, isArchived: true });
    const a = await resolveChannelAccess(ch.id, someone.id);
    expect(a?.canRead).toBe(false);
    expect(a?.canPost).toBe(false);
  });

  it('archived PUBLIC: still readable for an existing member (history)', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const ch = await makeChannel({ kind: 'PUBLIC', createdById: owner.id, isArchived: true });
    await ensureMembership(ch.id, member.id);
    const a = await resolveChannelAccess(ch.id, member.id);
    expect(a?.canRead).toBe(true);
    expect(a?.canPost).toBe(false);
  });
});

describe('resolveChannelAccess — PRIVATE/DM/GROUP_DM', () => {
  it.each([['PRIVATE'], ['DM'], ['GROUP_DM']] as const)(
    '%s — non-member sees nothing',
    async (kind) => {
      const owner = await makeUser();
      const stranger = await makeUser();
      const ch = await makeChannel({ kind, createdById: owner.id });
      const a = await resolveChannelAccess(ch.id, stranger.id);
      expect(a?.canRead).toBe(false);
      expect(a?.canPost).toBe(false);
      expect(a?.isMember).toBe(false);
    },
  );

  it.each([['PRIVATE'], ['DM'], ['GROUP_DM']] as const)(
    '%s — member can read and post',
    async (kind) => {
      const owner = await makeUser();
      const member = await makeUser();
      const ch = await makeChannel({ kind, createdById: owner.id });
      await ensureMembership(ch.id, member.id);
      const a = await resolveChannelAccess(ch.id, member.id);
      expect(a?.canRead).toBe(true);
      expect(a?.canPost).toBe(true);
      expect(a?.isMember).toBe(true);
    },
  );

  it('archived PRIVATE: member keeps read, loses post', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const ch = await makeChannel({
      kind: 'PRIVATE', createdById: owner.id, isArchived: true,
    });
    await ensureMembership(ch.id, member.id);
    const a = await resolveChannelAccess(ch.id, member.id);
    expect(a?.canRead).toBe(true);
    expect(a?.canPost).toBe(false);
  });
});

describe('ensureMembership', () => {
  it('creates a member row with role=MEMBER on first call', async () => {
    const owner = await makeUser();
    const target = await makeUser();
    const ch = await makeChannel({ kind: 'PUBLIC', createdById: owner.id });
    await ensureMembership(ch.id, target.id);
    const row = await prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId: ch.id, userId: target.id } },
    });
    expect(row?.role).toBe('MEMBER');
  });

  it('second call is a no-op (upsert update {})', async () => {
    const owner = await makeUser();
    const ch = await makeChannel({ kind: 'PUBLIC', createdById: owner.id });
    await ensureMembership(ch.id, owner.id);
    // Pretend the user was promoted to ADMIN somewhere else.
    await prisma.channelMember.update({
      where: { channelId_userId: { channelId: ch.id, userId: owner.id } },
      data: { role: 'ADMIN' },
    });
    await ensureMembership(ch.id, owner.id);
    const row = await prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId: ch.id, userId: owner.id } },
    });
    // Role survives — ensureMembership must NOT downgrade an existing
    // member to plain MEMBER.
    expect(row?.role).toBe('ADMIN');
  });
});

describe('resolveChannelAccess — edge cases', () => {
  it('returns null for an unknown channel', async () => {
    const u = await makeUser();
    expect(await resolveChannelAccess('00000000-0000-0000-0000-000000000000', u.id)).toBeNull();
  });
});
