/**
 * Shared helper: turn buffered Telegram messages of a linked project chat
 * into Task rows. Used by both the apps/tg-bot multi-bot runner (when a
 * PM types `/harvest [N]` in the group) and the apps/web UI button
 * ("Собрать N сообщений в задачи" on the integration page / project
 * Telegram panel).
 */

import type { PrismaClient } from '@giper/db';

const MAX_RETRIES = 10;

async function createTaskFromText(
  prisma: PrismaClient,
  projectId: string,
  creatorId: string,
  title: string,
  description: string,
): Promise<number> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const max = await prisma.task.aggregate({
      where: { projectId },
      _max: { number: true },
    });
    const nextNumber = (max._max.number ?? 0) + 1;
    try {
      const created = await prisma.task.create({
        data: {
          projectId,
          number: nextNumber,
          title,
          description,
          creatorId,
          status: 'BACKLOG',
          priority: 'MEDIUM',
          type: 'TASK',
        },
        select: { number: true },
      });
      return created.number;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 50) * (attempt + 1)));
    }
  }
  throw lastErr ?? new Error('task number conflict');
}

export type HarvestResult = {
  createdTaskNumbers: number[];
  emptyBuffer: boolean;
};

/**
 * Run a single harvest pass over the link's unharvested message buffer.
 *
 * @param limit  How many of the most recent buffered messages to consume.
 *               Capped 1..100, default 25.
 */
export async function runHarvest(
  prisma: PrismaClient,
  link: { id: string; project: { id: string } },
  actorId: string,
  limit = 25,
): Promise<HarvestResult> {
  const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit) || 25));

  const rows = await prisma.telegramProjectMessage.findMany({
    where: { linkId: link.id, harvestedAt: null },
    orderBy: { capturedAt: 'desc' },
    take: safeLimit,
  });

  if (!rows.length) {
    return { createdTaskNumbers: [], emptyBuffer: true };
  }

  const chronological = [...rows].reverse();
  const created: number[] = [];
  const now = new Date();

  for (const row of chronological) {
    const full = row.text.trim();
    if (full.length < 2) continue;
    const firstLine = full.split(/\r?\n/).find((line) => line.trim()) ?? full;
    const title = firstLine.trim().slice(0, 220);
    if (!title) continue;
    const description = full.slice(0, 12000);

    try {
      const num = await createTaskFromText(prisma, link.project.id, actorId, title, description);
      created.push(num);
      await prisma.telegramProjectMessage.update({
        where: { id: row.id },
        data: { harvestedAt: now },
      });
    } catch {
      // eslint-disable-next-line no-console
      console.error('[harvest] row failed', row.id);
    }
  }

  return { createdTaskNumbers: created, emptyBuffer: false };
}
