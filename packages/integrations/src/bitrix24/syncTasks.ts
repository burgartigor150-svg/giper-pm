import type { PrismaClient } from '@giper/db';
import { Bitrix24Client } from './client';
import type { BxTask } from './types';
import { mapBitrixTask } from './mappers';
import { syncTaskAttachments, type SyncFilesResult } from './syncFiles';
import { syncTaskComments, type SyncCommentsResult } from './syncComments';

export type SyncTasksResult = {
  totalSeen: number;
  created: number;
  updated: number;
  skippedNoProject: number;
  errors: number;
  files: SyncFilesResult;
  comments: SyncCommentsResult;
};

export type SyncTasksOptions = {
  /** Only return tasks updated at or after this moment. */
  since?: Date | null;
  /**
   * When set, fetch only tasks where this Bitrix24 user is RESPONSIBLE_ID
   * or CREATED_BY. We issue two separate `tasks.task.list` calls (one per
   * field) and dedupe by id — Bitrix's filter LOGIC=OR is per-method and
   * unreliable across portals; two narrow calls are safer and still fast.
   */
  forBitrixUserId?: string | null;
};

/**
 * Mirror Bitrix24 tasks → our Task table. Only tasks belonging to a
 * synced workgroup (project with externalSource='bitrix24') are imported;
 * standalone Bitrix tasks (groupId=0) are skipped — we don't manufacture
 * a synthetic "personal" project.
 */
export async function syncTasks(
  prisma: PrismaClient,
  client: Bitrix24Client,
  opts: SyncTasksOptions = {},
): Promise<SyncTasksResult> {
  const stats: SyncTasksResult = {
    totalSeen: 0,
    created: 0,
    updated: 0,
    skippedNoProject: 0,
    errors: 0,
    files: { totalSeen: 0, created: 0, updated: 0, deleted: 0, errors: 0 },
    comments: { totalSeen: 0, created: 0, updated: 0, deleted: 0, errors: 0 },
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

  // Personal-mirror runs land tasks without a workgroup (groupId='0') in
  // a virtual MINE project. We allocate it lazily — only the first time
  // we actually see a personal task, so global mirrors don't grow stray
  // empty projects.
  let personalProjectId: string | null = null;
  const ensurePersonal = async (): Promise<string | null> => {
    if (!opts.forBitrixUserId) return null;
    if (personalProjectId) return personalProjectId;
    personalProjectId = await ensurePersonalProject(prisma, fallbackCreator);
    return personalProjectId;
  };

  // tasks.task.list supports a special `MEMBER` filter that matches any
  // role on a task — RESPONSIBLE_ID, CREATED_BY, ACCOMPLICES, or AUDITORS —
  // in a single call. That's "all my tasks including collabs": personal
  // todos plus tasks I'm watching or co-working on. One pass, no dedupe.
  const baseFilter: Record<string, unknown> = {};
  if (opts.since) baseFilter['>=CHANGED_DATE'] = opts.since.toISOString();
  if (opts.forBitrixUserId) baseFilter.MEMBER = opts.forBitrixUserId;

  const filters: Record<string, unknown>[] = [baseFilter];
  const seenIds = new Set<string>();

  for (const filter of filters) {
    let start = 0;
    while (true) {
      const page = await client.call<{ tasks: BxTask[] }>('tasks.task.list', {
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
          'UF_TASK_WEBDAV_FILES',
        ],
        start,
      });
      const items = page.result?.tasks ?? [];
      if (items.length === 0) break;

      for (const raw of items) {
        if (seenIds.has(raw.id)) continue;
        seenIds.add(raw.id);
        stats.totalSeen++;
        try {
          const localTaskId = await upsertOne(
            prisma,
            raw,
            projectByExternalId,
            userByBitrixId,
            fallbackCreator,
            ensurePersonal,
            stats,
          );
          if (localTaskId) {
            // Files live on the camelCase response as `ufTaskWebdavFiles`.
            const fileIds = (raw.ufTaskWebdavFiles ?? []).map(String).filter(Boolean);
            await syncTaskAttachments(
              prisma,
              client,
              { id: localTaskId, bitrixTaskId: raw.id, attachmentIds: fileIds },
              stats.files,
            );
            // Comments — pulled per task because `task.commentitem.list`
            // (the bulk endpoint) doesn't exist; we have to enumerate
            // per task ID. Cheap on incremental syncs because the
            // since-watermark already shrinks the task list.
            await syncTaskComments(
              prisma,
              client,
              { id: localTaskId, bitrixTaskId: raw.id },
              stats.comments,
            );
          }
        } catch (e) {
          stats.errors++;
          // eslint-disable-next-line no-console
          console.error('bitrix24 syncTasks: failed to upsert task', raw.id, e);
        }
      }

      if (typeof page.next !== 'number') break;
      start = page.next;
    }
  }

  return stats;
}

async function upsertOne(
  prisma: PrismaClient,
  raw: BxTask,
  projectByExternalId: Map<string, string>,
  userByBitrixId: Map<string, string>,
  fallbackCreator: string | null,
  ensurePersonalProjectId: () => Promise<string | null>,
  stats: SyncTasksResult,
): Promise<string | null> {
  const mapped = mapBitrixTask(raw);
  let projectId: string | undefined;

  if (mapped.bitrixGroupId) {
    projectId = projectByExternalId.get(mapped.bitrixGroupId);
    if (!projectId) {
      // The task points to a workgroup we didn't sync (rare — happens
      // when the user can read the task but isn't a member of its group
      // and the group wasn't seeded into extraGroupIds).
      stats.skippedNoProject++;
      return null;
    }
  } else {
    // Personal task (groupId=0). Land it in the user's MINE project.
    const personal = await ensurePersonalProjectId();
    if (!personal) {
      // Global mirror isn't allowed to manufacture a MINE project.
      stats.skippedNoProject++;
      return null;
    }
    projectId = personal;
  }

  const assigneeId = mapped.bitrixResponsibleId
    ? userByBitrixId.get(mapped.bitrixResponsibleId) ?? null
    : null;
  const creatorId =
    (mapped.bitrixCreatedById ? userByBitrixId.get(mapped.bitrixCreatedById) : null) ??
    fallbackCreator;
  if (!creatorId) {
    stats.errors++;
    return null;
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
    return found.id;
  }

  // Allocate next number per project. Not hot-path during steady state.
  const max = await prisma.task.aggregate({
    where: { projectId },
    _max: { number: true },
  });
  const number = (max._max.number ?? 0) + 1;
  const created = await prisma.task.create({
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
    select: { id: true },
  });
  stats.created++;
  return created.id;
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

/**
 * Ensure a MINE project exists for personal tasks. Marked synthetic via
 * (externalSource='bitrix24', externalId='__personal__') so it dedupes
 * across runs and can't collide with a real workgroup id (workgroup ids
 * in Bitrix are numeric, this one isn't). The owner is the first ADMIN.
 */
async function ensurePersonalProject(
  prisma: PrismaClient,
  fallbackOwnerId: string | null,
): Promise<string | null> {
  if (!fallbackOwnerId) return null;
  const PERSONAL_KEY = 'MINE';
  const PERSONAL_EXT_ID = '__personal__';
  const existing = await prisma.project.findUnique({
    where: {
      externalSource_externalId: {
        externalSource: 'bitrix24',
        externalId: PERSONAL_EXT_ID,
      },
    },
    select: { id: true },
  });
  if (existing) return existing.id;

  // Find a free key. Most installations won't have a manual MINE; fall
  // back to MINE2..MINE9 if needed. We never overwrite a hand-made one.
  let key = PERSONAL_KEY;
  for (let i = 2; i < 10; i++) {
    if (!(await prisma.project.findUnique({ where: { key }, select: { id: true } }))) break;
    key = `MINE${i}`;
  }
  const created = await prisma.project.create({
    data: {
      key,
      name: 'Личные задачи (Bitrix24)',
      description: 'Задачи без рабочей группы — синхронизируются из Bitrix24.',
      ownerId: fallbackOwnerId,
      externalSource: 'bitrix24',
      externalId: PERSONAL_EXT_ID,
      members: {
        create: { userId: fallbackOwnerId, role: 'LEAD' },
      },
    },
    select: { id: true },
  });
  return created.id;
}
