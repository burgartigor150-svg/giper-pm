/**
 * One-shot backfill: for every active mirrored Bitrix24 task in giper-pm,
 * pull its full comment list and upsert into our Comment table.
 *
 * Why this exists: webhook-based comment sync only catches new chatter
 * once the webhook fix landed. Historic comments on long-lived tasks
 * were never imported (bulk sync's CHANGED_DATE watermark skips tasks
 * that didn't move). This script catches them up in one pass.
 *
 * Safe: uses syncTaskComments with skipDeletes=true, so we never drop
 * local rows even if the per-task getlist returns a narrower view.
 *
 * Run on prod (inside the tg-bot container — it ships tsx + sources):
 *   docker compose -f /opt/giper-pm/docker-compose.prod.yml exec -T tg-bot \
 *     npx tsx /app/apps/tg-bot/scripts/backfillBitrix24Comments.ts
 *
 * Progress is printed per task. Safe to Ctrl+C at any point — every
 * task is its own transaction.
 */
import { prisma } from '@giper/db';
import {
  Bitrix24Client,
  syncTaskComments,
  type SyncCommentsResult,
} from '@giper/integrations/bitrix24';

async function main() {
  const webhookUrl = process.env.BITRIX24_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    console.error('BITRIX24_WEBHOOK_URL not set');
    process.exit(1);
  }
  const client = new Bitrix24Client({ webhookUrl });

  // Active = anything not DONE/CANCELED, mirrored from Bitrix.
  const tasks = await prisma.task.findMany({
    where: {
      externalSource: 'bitrix24',
      externalId: { not: null },
      status: { notIn: ['DONE', 'CANCELED'] },
    },
    select: { id: true, externalId: true, number: true, title: true },
    orderBy: { number: 'asc' },
  });

  console.log(`[backfill] ${tasks.length} active mirrored tasks to scan`);

  const totals = { created: 0, updated: 0, errors: 0, skipped: 0 };
  const startedAt = Date.now();

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i]!;
    if (!t.externalId) continue;
    const stats: SyncCommentsResult = {
      totalSeen: 0,
      created: 0,
      updated: 0,
      deleted: 0,
      errors: 0,
    };
    try {
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
      const tag = stats.created > 0 || stats.updated > 0 ? '+' : ' ';
      console.log(
        `[backfill] [${i + 1}/${tasks.length}] ${tag} bx=${t.externalId} ` +
          `seen=${stats.totalSeen} created=${stats.created} updated=${stats.updated} errors=${stats.errors} ` +
          `"${t.title.slice(0, 50)}"`,
      );
    } catch (e) {
      totals.errors++;
      console.error(
        `[backfill] [${i + 1}/${tasks.length}] FAIL bx=${t.externalId}`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(
    `\n[backfill] done in ${elapsedSec}s — ` +
      `created=${totals.created} updated=${totals.updated} errors=${totals.errors}`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('[backfill] fatal:', e);
  process.exit(1);
});
