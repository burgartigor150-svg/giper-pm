import type { PrismaClient } from '@giper/db';
import type { Bitrix24Client } from './client';
import { syncTaskComments, type SyncCommentsResult } from './syncComments';
import { syncTaskHistory, type SyncHistoryResult } from './syncHistory';
import { syncTaskChat, type SyncChatResult } from './syncChat';

export type BackfillAuthorsResult = {
  /** Tasks re-synced this call. */
  processed: number;
  /** Pass back as `after` to continue; null = nothing left. */
  nextCursor: string | null;
  done: boolean;
};

/**
 * Targeted backfill for the Bitrix author mis-attribution that the DB-only
 * migration couldn't fix (comments wrongly pinned on a Bitrix-LINKED admin —
 * indistinguishable from genuine ones without re-fetching upstream).
 *
 * Re-runs the comment/history/chat sync for the tasks that still carry an
 * admin-authored mirrored comment — re-resolving each author from the live
 * Bitrix payload (robot/`author_id` 0 / unmatched → the Bitrix24 bot; a genuine
 * matched author stays). Operates DIRECTLY on our task rows (by id cursor), so
 * it ignores the group-coverage + CHANGED_DATE watermark that make a full sync
 * miss old tasks; bounded by `limit` so it can't time out — call again with
 * `nextCursor` until `done`.
 */
export async function backfillAdminAttributedComments(
  prisma: PrismaClient,
  client: Bitrix24Client,
  opts: { limit?: number; after?: string } = {},
): Promise<BackfillAuthorsResult> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 2000);
  let cursor = opts.after ?? '';
  let processed = 0;
  let done = false;

  const cStats: SyncCommentsResult = { totalSeen: 0, created: 0, updated: 0, deleted: 0, errors: 0 };
  const hStats: SyncHistoryResult = { totalSeen: 0, created: 0, updated: 0, errors: 0 };
  const chatStats: SyncChatResult = { totalSeen: 0, created: 0, updated: 0, errors: 0 };

  while (processed < limit) {
    const batch = await prisma.task.findMany({
      where: {
        externalSource: 'bitrix24',
        externalId: { not: null },
        id: { gt: cursor },
        comments: {
          some: {
            externalSource: 'bitrix24',
            OR: [
              // Author mis-attribution: still pinned on a real admin.
              { author: { role: 'ADMIN' } },
              // Mangled body: leftover relative Bitrix action-link (`](/…`)
              // or an un-parsed `[TIMESTAMP …]` tag. Re-syncing re-runs the
              // fixed converter so the date comes back and the junk link goes.
              { body: { contains: '](/' } },
              { body: { contains: '[TIMESTAMP' } },
            ],
          },
        },
      },
      select: { id: true, externalId: true, bitrixChatId: true },
      orderBy: { id: 'asc' },
      take: Math.min(25, limit - processed),
    });
    if (batch.length === 0) {
      done = true;
      break;
    }
    for (const t of batch) {
      try {
        if (t.bitrixChatId) {
          await syncTaskChat(
            prisma, client,
            { id: t.id, bitrixTaskId: t.externalId!, chatId: t.bitrixChatId },
            chatStats,
          );
        } else {
          await syncTaskComments(prisma, client, { id: t.id, bitrixTaskId: t.externalId! }, cStats);
          await syncTaskHistory(prisma, client, { id: t.id, bitrixTaskId: t.externalId! }, hStats);
        }
      } catch (e) {
        // Per-task failure must not abort the batch — skip and continue.
        // eslint-disable-next-line no-console
        console.error('backfillAdminAttributedComments: task failed', t.id, e);
      }
      cursor = t.id;
      processed++;
    }
  }

  return { processed, nextCursor: done ? null : cursor, done };
}
