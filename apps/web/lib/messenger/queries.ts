import { prisma } from '@giper/db';
import { resolveChannelAccess } from './access';

export type LoadMessagesOptions = {
  /**
   * Cursor pagination by createdAt. Loads messages strictly older than
   * `before` so we can infinite-scroll up. Omit for the latest page.
   */
  before?: Date;
  limit?: number;
  /**
   * Thread root id — when set, loads replies inside that thread,
   * sorted ascending by createdAt (oldest first, latest at bottom).
   */
  threadRootId?: string;
};

/**
 * Loads messages for a channel ordered newest-first (so the UI can
 * reverse the array for chronological top-down rendering and prepend
 * older pages on scroll-up). Returns the resolved User and reaction
 * data needed for the row, plus reply counts surfaced via the cached
 * Message.replyCount column.
 */
export async function loadChannelMessages(
  channelId: string,
  userId: string,
  opts: LoadMessagesOptions = {},
) {
  const access = await resolveChannelAccess(channelId, userId);
  if (!access || !access.canRead) return null;

  const limit = Math.min(opts.limit ?? 50, 200);

  const where: Parameters<typeof prisma.message.findMany>[0] extends infer T
    ? T extends { where?: infer W }
      ? W
      : never
    : never = {
    channelId,
    deletedAt: null,
  } as never;
  // Filter to top-level OR thread replies.
  if (opts.threadRootId) {
    (where as { parentId?: string }).parentId = opts.threadRootId;
  } else {
    (where as { parentId?: null }).parentId = null;
  }
  if (opts.before) {
    (where as { createdAt?: { lt: Date } }).createdAt = { lt: opts.before };
  }

  const rows = await prisma.message.findMany({
    where,
    orderBy: opts.threadRootId ? { createdAt: 'asc' } : { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      body: true,
      authorId: true,
      author: { select: { id: true, name: true, image: true } },
      parentId: true,
      replyCount: true,
      editedAt: true,
      createdAt: true,
      reactions: {
        select: { userId: true, emoji: true },
      },
    },
  });

  return { access, messages: rows };
}
