import { prisma } from '@giper/db';
import { resolveChannelAccess } from './access';
import { extractTaskRefs } from '@/lib/text/taskRefs';
import { loadTaskPreviewsForRefs, type TaskPreview } from '@/lib/tasks/loadTaskPreviews';

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
      mentions: {
        select: { userId: true },
      },
      // Attachments — video-notes/files/etc. Filtered to non-deleted
      // (cascade-on-message-delete handles deletion; we don't have
      // a per-attachment soft-delete column).
      attachments: {
        select: {
          id: true,
          kind: true,
          mimeType: true,
          sizeBytes: true,
          durationSec: true,
          width: true,
          height: true,
          filename: true,
        },
      },
    },
  });

  // Resolve mentioned user ids → name in one query, return as a flat
  // list so the client can build a Map for renderRichText.
  const mentionedIds = Array.from(
    new Set(rows.flatMap((m) => m.mentions.map((x) => x.userId))),
  );
  const mentionedUsers = mentionedIds.length
    ? await prisma.user.findMany({
        where: { id: { in: mentionedIds } },
        select: { id: true, name: true, image: true },
      })
    : [];

  // Extract task references (GPM-142, /projects/GPM/tasks/142, full
  // URLs) from every visible message body in one pass. Visibility of
  // each task is per-viewer — see loadTaskPreviewsForRefs.
  const allRefs = rows.flatMap((m) => extractTaskRefs(m.body));
  const uniqueRefs = Array.from(
    new Map(allRefs.map((r) => [`${r.key}-${r.number}`, r])).values(),
  );
  const taskPreviews = uniqueRefs.length
    ? await loadTaskPreviewsForRefs(uniqueRefs, userId)
    : new Map<string, TaskPreview>();

  return {
    access,
    messages: rows,
    mentionedUsers,
    /**
     * Flat lookup: "GPM-142" → TaskPreview. The shell builds per-row
     * cards by re-running extractTaskRefs on the body and resolving
     * here. We don't pre-attach refs to each message because the
     * client renderer already has the body string and can do it once
     * — avoids shipping the same preview multiple times across rows.
     */
    taskPreviews: Array.from(taskPreviews.values()),
  };
}
