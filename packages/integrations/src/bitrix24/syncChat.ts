import type { PrismaClient } from '@giper/db';
import { Bitrix24Client } from './client';
import { convertBitrixMarkup } from './mappers';

/**
 * Mirror Bitrix24 task chat (IM messenger conversation) into local
 * Comment rows. New "collab"-style tasks store discussion in the
 * messenger instead of the legacy task forum:
 *
 *   im.dialog.messages.get  with  DIALOG_ID = `chat<chatId>`
 *
 * The legacy task.commentitem.getlist returns 0 for these tasks —
 * which is why their feeds in giper-pm looked completely empty.
 *
 * Storage model: each chat message → Comment row with
 *   externalSource='bitrix24', externalId='chat:<msgId>'
 * The 'chat:' prefix is a fresh namespace so it never collides with
 * regular comments ('<numeric>') or history events ('hist:<id>').
 *
 * Author resolution: messenger payloads already include `users` keyed
 * by author id; we resolve to local User by bitrixUserId or fall back
 * to the first ADMIN. System messages (author_id=0) are author'd to
 * the same admin and rendered with the history-row look in the UI.
 */

export type SyncChatResult = {
  totalSeen: number;
  created: number;
  updated: number;
  errors: number;
};

type BxMessage = {
  id: number | string;
  date: string;
  author_id: number | string;
  text?: string;
  /** When set, message is a system event (status change, member added, …). */
  system?: 'Y' | 'N' | boolean;
};

type BxDialogMessagesResult = {
  messages?: BxMessage[];
  users?: Record<string, { id: number; name?: string; last_name?: string }>;
};

const PAGE_LIMIT = 50;
const MAX_PAGES = 200; // hard cap to keep one task from running away

export async function syncTaskChat(
  prisma: PrismaClient,
  client: Bitrix24Client,
  task: { id: string; bitrixTaskId: string; chatId: string },
  stats: SyncChatResult,
): Promise<void> {
  // 1. Pull the entire chat history. im.dialog.messages.get returns
  //    pages newest→oldest; we keep walking with LAST_ID = min(seen)
  //    until a page comes back empty (no more older messages).
  const all: BxMessage[] = [];
  let lastId: number | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params: Record<string, unknown> = {
      DIALOG_ID: `chat${task.chatId}`,
      LIMIT: PAGE_LIMIT,
    };
    if (lastId !== undefined) params.LAST_ID = lastId;
    let r;
    try {
      r = await client.call<BxDialogMessagesResult>(
        'im.dialog.messages.get',
        params,
      );
    } catch (e) {
      stats.errors++;
      // eslint-disable-next-line no-console
      console.error('bitrix24 syncChat: pull failed for', task.chatId, e);
      return;
    }
    const msgs = r.result?.messages ?? [];
    if (msgs.length === 0) break;
    all.push(...msgs);
    // Walk older. min(id) of the page; subtract 1 wouldn't be right
    // because ids aren't dense — Bitrix returns "older than LAST_ID".
    const minId = Math.min(...msgs.map((m) => Number(m.id)).filter(Number.isFinite));
    if (!Number.isFinite(minId) || minId === lastId) break;
    lastId = minId;
    if (msgs.length < PAGE_LIMIT) break; // last page (no more older)
  }

  if (all.length === 0) return;

  // 2. Resolve authors. messenger ids → local User by bitrixUserId.
  const authorBxIds = Array.from(
    new Set(all.map((m) => String(m.author_id)).filter((x) => x && x !== '0')),
  );
  const localAuthors = authorBxIds.length
    ? await prisma.user.findMany({
        where: { bitrixUserId: { in: authorBxIds } },
        select: { id: true, bitrixUserId: true },
      })
    : [];
  const userByBxId = new Map(
    localAuthors
      .filter((u): u is typeof u & { bitrixUserId: string } => !!u.bitrixUserId)
      .map((u) => [u.bitrixUserId, u.id]),
  );
  const adminFallback = await prisma.user.findFirst({
    where: { role: 'ADMIN', isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!adminFallback) return;

  // 3. Upsert each message into Comment.
  for (const m of all) {
    stats.totalSeen++;
    try {
      const externalId = `chat:${m.id}`;
      const bxAuthorId = String(m.author_id);
      const authorId =
        bxAuthorId !== '0' && userByBxId.has(bxAuthorId)
          ? userByBxId.get(bxAuthorId)!
          : adminFallback.id;
      const body = convertBitrixMarkup(m.text ?? '').slice(0, 50_000);
      if (!body) continue;
      const createdAt = m.date ? new Date(m.date) : new Date();

      const existing = await prisma.comment.findUnique({
        where: {
          externalSource_externalId: {
            externalSource: 'bitrix24',
            externalId,
          },
        },
        select: { id: true, body: true },
      });
      if (existing) {
        if (existing.body !== body) {
          await prisma.comment.update({
            where: { id: existing.id },
            data: { body },
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
          externalId,
          createdAt,
        },
      });
      stats.created++;
    } catch (e) {
      stats.errors++;
      // eslint-disable-next-line no-console
      console.error('bitrix24 syncChat: upsert failed for', m.id, e);
    }
  }
}
