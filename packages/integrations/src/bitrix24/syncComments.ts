import type { PrismaClient } from '@giper/db';
import { Bitrix24Client } from './client';
import { convertBitrixMarkup } from './mappers';

export type SyncCommentsResult = {
  /** Comments seen across all tasks during this run. */
  totalSeen: number;
  /** New Comment rows written. */
  created: number;
  /** Existing Comment rows whose body changed (rare — Bitrix allows edits). */
  updated: number;
  /** Local rows removed because the corresponding comment is gone in Bitrix. */
  deleted: number;
  errors: number;
};

type BxComment = {
  ID: string;
  AUTHOR_ID: string;
  AUTHOR_NAME?: string;
  POST_MESSAGE: string;
  POST_DATE: string;
};

/**
 * Pull task-level comments for one task from Bitrix24 and reconcile
 * with our local Comment table.
 *
 * Source of truth: `task.commentitem.getlist` returns all comments
 * for a task. We:
 *   - keep our existing local rows that match by externalId,
 *   - update body/POST_DATE if upstream changed,
 *   - create rows for new upstream comments,
 *   - delete local rows whose externalId is no longer in the
 *     upstream list (covers Bitrix-side comment deletes).
 *
 * Comments synced from Bitrix are stored with:
 *   - source = 'WEB' (no dedicated 'BITRIX24' enum value yet)
 *   - visibility = 'EXTERNAL' (they're already client-visible)
 *   - externalSource/externalId so the outbound dedupe path can
 *     recognise its own echo when we later push a new comment.
 *
 * Author resolution: prefer matching on User.bitrixUserId. If no
 * local user matches, fall back to the first ADMIN. We never invent
 * a user — that would let webhook payloads spawn rows.
 */
export async function syncTaskComments(
  prisma: PrismaClient,
  client: Bitrix24Client,
  task: { id: string; bitrixTaskId: string },
  stats: SyncCommentsResult,
): Promise<void> {
  let comments: BxComment[];
  try {
    comments = await client.all<BxComment>('task.commentitem.getlist', {
      TASKID: task.bitrixTaskId,
    });
  } catch (e) {
    stats.errors++;
    // eslint-disable-next-line no-console
    console.error(
      'bitrix24 syncComments: failed to fetch comments for task',
      task.bitrixTaskId,
      e,
    );
    return;
  }

  const remoteIds = new Set<string>(comments.map((c) => c.ID));

  // Drop local rows that disappeared upstream. Only target rows we
  // own (externalSource='bitrix24'); comments authored locally and
  // not yet pushed have externalSource=null and are out of scope.
  const stale = await prisma.comment.findMany({
    where: { taskId: task.id, externalSource: 'bitrix24' },
    select: { id: true, externalId: true },
  });
  const toDelete = stale.filter((c) => c.externalId && !remoteIds.has(c.externalId));
  if (toDelete.length > 0) {
    await prisma.comment.deleteMany({
      where: { id: { in: toDelete.map((c) => c.id) } },
    });
    stats.deleted += toDelete.length;
  }

  // Resolve a fallback author once per task.
  const adminFallback = await prisma.user.findFirst({
    where: { role: 'ADMIN', isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!adminFallback) {
    // No admin to attribute orphan comments to — bail with an error
    // counter so the upstream caller can surface it. We don't throw
    // because the rest of the task sync should still succeed.
    if (comments.length > 0) stats.errors++;
    return;
  }

  for (const c of comments) {
    stats.totalSeen++;
    try {
      const author = await prisma.user.findFirst({
        where: { bitrixUserId: c.AUTHOR_ID },
        select: { id: true },
      });
      const authorId = author?.id ?? adminFallback.id;
      const body = convertBitrixMarkup(c.POST_MESSAGE ?? '').slice(0, 50_000);
      const createdAt = c.POST_DATE ? new Date(c.POST_DATE) : new Date();

      const existing = await prisma.comment.findUnique({
        where: {
          externalSource_externalId: {
            externalSource: 'bitrix24',
            externalId: c.ID,
          },
        },
        select: { id: true, body: true, taskId: true },
      });

      if (existing) {
        // Edit detection: Bitrix allows comment edits. We mirror that
        // by overwriting our row when the body differs.
        if (existing.body !== body || existing.taskId !== task.id) {
          await prisma.comment.update({
            where: { id: existing.id },
            data: { body, taskId: task.id },
          });
          stats.updated++;
        }
        continue;
      }

      await prisma.comment.create({
        data: {
          taskId: task.id,
          authorId,
          body,
          source: 'WEB',
          visibility: 'EXTERNAL',
          externalSource: 'bitrix24',
          externalId: c.ID,
          createdAt,
        },
      });
      stats.created++;
    } catch (e) {
      stats.errors++;
      // eslint-disable-next-line no-console
      console.error('bitrix24 syncComments: failed to upsert comment', c.ID, e);
    }
  }
}

// stripBitrixCommentMarkup → moved into mappers.convertBitrixMarkup so
// task descriptions and comments share one renderer.
