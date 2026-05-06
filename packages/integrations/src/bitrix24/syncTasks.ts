import type { PrismaClient } from '@giper/db';
import { Bitrix24Client } from './client';
import type { BxTask } from './types';
import { mapBitrixTask } from './mappers';

export type SyncTasksResult = {
  totalSeen: number;
  created: number;
  updated: number;
  skippedNoProject: number;
  errors: number;
};

/**
 * Mirror Bitrix24 tasks → our Task table. Only tasks belonging to a
 * synced workgroup (project with externalSource='bitrix24') are imported;
 * standalone Bitrix tasks (groupId=0) are skipped — we don't manufacture
 * a synthetic "personal" project.
 *
 * Incremental: pass `since` to only fetch tasks changed after that timestamp.
 * `tasks.task.list` accepts `>=CHANGED_DATE` in its filter.
 */
export async function syncTasks(
  prisma: PrismaClient,
  client: Bitrix24Client,
  opts: { since?: Date | null } = {},
): Promise<SyncTasksResult> {
  const stats: SyncTasksResult = {
    totalSeen: 0,
    created: 0,
    updated: 0,
    skippedNoProject: 0,
    errors: 0,
  };

  const projectByExternalId = new Map<string, string>();
  for (const p of await prisma.project.findMany({
    where: { externalSource: 'bitrix24' },
    select: { id: true, externalId: true },
  })) {
    if (p.externalId) projectByExternalId.set(p.externalId, p.id);
  }

  const userByBitrixId = new Map<string, string>();
  for (const u of await prisma.user.findMany({
    where: { bitrixUserId: { not: null } },
    select: { id: true, bitrixUserId: true },
  })) {
    if (u.bitrixUserId) userByBitrixId.set(u.bitrixUserId, u.id);
  }

  const fallbackCreator = await firstAdminId(prisma);

  type Page = { tasks: BxTask[] };
  const filter: Record<string, unknown> = {};
  if (opts.since) filter['>=CHANGED_DATE'] = opts.since.toISOString();

  let start = 0;
  while (true) {
    const page = await client.call<Page>('tasks.task.list', {
      filter,
      order: { CHANGED_DATE: 'asc' },
      select: [
        'ID',
        'TITLE',
        'DESCRIPTION',
        'STATUS',
        'PRIORITY',
        'GROUP_ID',
        'RESPONSIBLE_ID',
        'CREATED_BY',
        'CREATED_DATE',
        'CHANGED_DATE',
        'CLOSED_DATE',
        'DEADLINE',
        'START_DATE_PLAN',
        'PARENT_ID',
      ],
      start,
    });
    const items = page.result?.tasks ?? [];
    if (items.length === 0) break;
    stats.totalSeen += items.length;

    for (const raw of items) {
      try {
        await upsertOne(prisma, raw, projectByExternalId, userByBitrixId, fallbackCreator, stats);
      } catch (e) {
        stats.errors++;
        // eslint-disable-next-line no-console
        console.error('bitrix24 syncTasks: failed to upsert task', raw.id, e);
      }
    }

    if (typeof page.next !== 'number') break;
    start = page.next;
  }

  return stats;
}

async function upsertOne(
  prisma: PrismaClient,
  raw: BxTask,
  projectByExternalId: Map<string, string>,
  userByBitrixId: Map<string, string>,
  fallbackCreator: string | null,
  stats: SyncTasksResult,
): Promise<void> {
  const mapped = mapBitrixTask(raw);
  if (!mapped.bitrixGroupId) {
    stats.skippedNoProject++;
    return;
  }
  const projectId = projectByExternalId.get(mapped.bitrixGroupId);
  if (!projectId) {
    stats.skippedNoProject++;
    return;
  }

  const assigneeId = mapped.bitrixResponsibleId
    ? userByBitrixId.get(mapped.bitrixResponsibleId) ?? null
    : null;
  const creatorId =
    (mapped.bitrixCreatedById ? userByBitrixId.get(mapped.bitrixCreatedById) : null) ??
    fallbackCreator;
  if (!creatorId) {
    stats.errors++;
    return;
  }

  const found = await prisma.task.findFirst({
    where: { externalSource: 'bitrix24', externalId: mapped.externalId },
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      dueDate: true,
      startedAt: true,
      completedAt: true,
      assigneeId: true,
      description: true,
    },
  });

  if (found) {
    const dirty =
      found.title !== mapped.title ||
      found.status !== mapped.status ||
      found.priority !== mapped.priority ||
      !sameDate(found.dueDate, mapped.dueDate) ||
      !sameDate(found.completedAt, mapped.completedAt) ||
      !sameDate(found.startedAt, mapped.startedAt) ||
      (found.description ?? null) !== (mapped.description ?? null) ||
      (found.assigneeId ?? null) !== (assigneeId ?? null);
    if (dirty) {
      await prisma.task.update({
        where: { id: found.id },
        data: {
          title: mapped.title,
          description: mapped.description,
          status: mapped.status,
          priority: mapped.priority,
          dueDate: mapped.dueDate,
          startedAt: mapped.startedAt,
          completedAt: mapped.completedAt,
          assigneeId,
        },
      });
      stats.updated++;
    }
    return;
  }

  // Allocate next number per project. Not hot-path during steady state.
  const max = await prisma.task.aggregate({
    where: { projectId },
    _max: { number: true },
  });
  const number = (max._max.number ?? 0) + 1;
  await prisma.task.create({
    data: {
      projectId,
      number,
      title: mapped.title,
      description: mapped.description,
      status: mapped.status,
      priority: mapped.priority,
      dueDate: mapped.dueDate,
      startedAt: mapped.startedAt,
      completedAt: mapped.completedAt,
      creatorId,
      assigneeId,
      externalSource: 'bitrix24',
      externalId: mapped.externalId,
    },
  });
  stats.created++;
}

function sameDate(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.getTime() === b.getTime();
}

async function firstAdminId(prisma: PrismaClient): Promise<string | null> {
  const a = await prisma.user.findFirst({
    where: { role: 'ADMIN', isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return a?.id ?? null;
}
