import { prisma } from '@giper/db';

/**
 * Permission helpers for messenger. Visibility rules:
 *   PUBLIC      — anyone in the org may read/post
 *   PRIVATE     — only ChannelMember
 *   DM/GROUP_DM — only ChannelMember
 *
 * Posting also requires membership for PRIVATE/DM/GROUP_DM. For PUBLIC
 * we lazily auto-join the user when they post for the first time —
 * keeps the UX of "type and send" without an explicit Join click.
 */

export type ChannelAccess = {
  channelId: string;
  canRead: boolean;
  canPost: boolean;
  isMember: boolean;
  kind: 'PUBLIC' | 'PRIVATE' | 'DM' | 'GROUP_DM';
};

export async function resolveChannelAccess(
  channelId: string,
  userId: string,
): Promise<ChannelAccess | null> {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { id: true, kind: true, isArchived: true },
  });
  if (!channel) return null;

  const member = await prisma.channelMember.findUnique({
    where: { channelId_userId: { channelId, userId } },
    select: { userId: true },
  });

  const isMember = !!member;
  if (channel.kind === 'PUBLIC') {
    return {
      channelId,
      kind: channel.kind,
      isMember,
      canRead: !channel.isArchived || isMember,
      canPost: !channel.isArchived,
    };
  }
  // PRIVATE / DM / GROUP_DM — must be a member.
  return {
    channelId,
    kind: channel.kind,
    isMember,
    canRead: isMember,
    canPost: isMember && !channel.isArchived,
  };
}

/**
 * Auto-join helper for PUBLIC channels: idempotent, returns the
 * member row's userId.
 */
export async function ensureMembership(channelId: string, userId: string): Promise<void> {
  await prisma.channelMember.upsert({
    where: { channelId_userId: { channelId, userId } },
    create: { channelId, userId, role: 'MEMBER' },
    update: {},
  });
}
