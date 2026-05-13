/**
 * One-shot backfill: for every active mirrored Bitrix24 task in giper-pm,
 * pull its full comment thread and upsert into our Comment table.
 *
 * Routing: Bitrix has moved task discussions from the legacy forum API
 * (task.commentitem.*) into the IM messenger for most tasks. We dispatch
 * per task:
 *   - if Task.bitrixChatId is set locally → syncTaskChat (im.dialog.messages.get)
 *   - else: probe tasks.task.get to refresh chatId. If a chat exists,
 *     persist it on the row and call syncTaskChat. Otherwise fall back
 *     to legacy syncTaskComments.
 *
 * Safe: syncTaskChat is upsert-only by externalId='chat:<id>'.
 * syncTaskComments runs with skipDeletes=true so we never drop local
 * rows even if the per-task getlist returns a narrower view.
 *
 * Run on prod (inside the tg-bot container — it ships tsx + sources):
 *   docker compose -f /opt/giper-pm/docker-compose.prod.yml exec -T tg-bot \
 *     npx tsx /app/apps/tg-bot/scripts/backfillBitrix24Comments.ts
 *
 * Progress is printed per task. Safe to Ctrl+C — every task is its
 * own set of independent writes.
 */
import { prisma } from '@giper/db';
import {
  Bitrix24Client,
  syncTaskComments,
  syncTaskChat,
  type SyncCommentsResult,
} from '@giper/integrations/bitrix24';
import type { BxTask } from '@giper/integrations/bitrix24';

type ChatStats = { totalSeen: number; created: number; updated: number; errors: number };

async function main() {
  const webhookUrl = process.env.BITRIX24_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    console.error('BITRIX24_WEBHOOK_URL not set');
    process.exit(1);
  }
  const client = new Bitrix24Client({ webhookUrl });

  const tasks = await prisma.task.findMany({
    where: {
      externalSource: 'bitrix24',
      externalId: { not: null },
      status: { notIn: ['DONE', 'CANCELED'] },
    },
    select: {
      id: true,
      externalId: true,
      number: true,
      title: true,
      bitrixChatId: true,
    },
    orderBy: { number: 'asc' },
  });

  console.log(`[backfill] ${tasks.length} active mirrored tasks to scan`);

  const totals = { created: 0, updated: 0, errors: 0, chatRoute: 0, forumRoute: 0 };
  const startedAt = Date.now();

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i]!;
    if (!t.externalId) continue;
    const tag = `[${i + 1}/${tasks.length}]`;
    try {
      let chatId = t.bitrixChatId;
      if (!chatId) {
        // Probe Bitrix for the chat backing of this task. Cheap relative
        // to comment fetch; result is persisted so subsequent webhooks
        // route correctly without another probe.
        const res = await client.call<{ task: BxTask }>('tasks.task.get', {
          taskId: t.externalId,
          select: ['ID', 'CHAT_ID'],
        });
        const upstreamChatId = res.result?.task?.chatId;
        if (upstreamChatId && upstreamChatId !== '0') {
          chatId = String(upstreamChatId);
          await prisma.task.update({
            where: { id: t.id },
            data: { bitrixChatId: chatId },
          });
        }
      }

      if (chatId) {
        totals.chatRoute++;
        const stats: ChatStats = { totalSeen: 0, created: 0, updated: 0, errors: 0 };
        await syncTaskChat(
          prisma,
          client,
          { id: t.id, bitrixTaskId: t.externalId, chatId },
          stats,
        );
        totals.created += stats.created;
        totals.updated += stats.updated;
        totals.errors += stats.errors;
        const mark = stats.created > 0 || stats.updated > 0 ? '+' : ' ';
        console.log(
          `[backfill] ${tag} ${mark} bx=${t.externalId} chat=${chatId} ` +
            `seen=${stats.totalSeen} created=${stats.created} updated=${stats.updated} errors=${stats.errors} ` +
            `"${t.title.slice(0, 50)}"`,
        );
      } else {
        totals.forumRoute++;
        const stats: SyncCommentsResult = {
          totalSeen: 0,
          created: 0,
          updated: 0,
          deleted: 0,
          errors: 0,
        };
        await syncTaskComments(
          prisma,
          client,
          { id: t.id, bitrixTaskId: t.externalId },
          stats,
          { skipDeletes: true },
        );
        totals.created += stats.created;
        totals.updated += stats.updated;
        totals.errors += stats.errors;
        const mark = stats.created > 0 || stats.updated > 0 ? '+' : ' ';
        console.log(
          `[backfill] ${tag} ${mark} bx=${t.externalId} forum ` +
            `seen=${stats.totalSeen} created=${stats.created} updated=${stats.updated} errors=${stats.errors} ` +
            `"${t.title.slice(0, 50)}"`,
        );
      }
    } catch (e) {
      totals.errors++;
      console.error(
        `[backfill] ${tag} FAIL bx=${t.externalId}`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(
    `\n[backfill] done in ${elapsedSec}s — ` +
      `created=${totals.created} updated=${totals.updated} errors=${totals.errors} ` +
      `(chat=${totals.chatRoute}, forum=${totals.forumRoute})`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('[backfill] fatal:', e);
  process.exit(1);
});
