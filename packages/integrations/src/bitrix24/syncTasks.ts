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

  // Personal-mirror runs land tasks without a workgroup (groupId='0')
  // in a virtual MINE project — one PER USER, owned by that user (not
  // by some shared admin). Allocated lazily on first personal task we
  // actually see, so global mirrors don't grow stray empty projects.
  let personalProjectId: string | null = null;
  const ensurePersonal = async (): Promise<string | null> => {
    if (!opts.forBitrixUserId) return null;
    if (personalProjectId) return personalProjectId;
    // Resolve "this user" — sync runs scoped to a Bitrix uid, so we
    // know whose MINE this is. The owner of the MINE row is the
    // resolved user; falls back to admin only if the user isn't in
    // our DB yet (rare — earlier syncUsers pass populates it).
    const ownerId =
      userByBitrixId.get(opts.forBitrixUserId) ?? fallbackCreator;
    personalProjectId = await ensurePersonalProject(
      prisma,
      ownerId,
      opts.forBitrixUserId,
    );
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
          'TAGS',
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
  // Resolved local creator from upstream CREATED_BY, or null if we don't
  // have a matching User row (yet). We use this both for the initial
  // create AND for re-resolving stale fallback-admin creators on update.
  const upstreamCreatorId = mapped.bitrixCreatedById
    ? userByBitrixId.get(mapped.bitrixCreatedById) ?? null
    : null;
  const creatorId = upstreamCreatorId ?? fallbackCreator;
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
      creatorId: true,
      bitrixCreatedById: true,
      bitrixResponsibleId: true,
    },
  });

  if (found) {
    // Re-resolve creator: if upstream maps to a real user that's
    // different from what we have on the row, prefer upstream. This
    // self-heals tasks that were imported before their creator's User
    // row was synced (and got the fallback admin written in).
    const creatorChanged =
      upstreamCreatorId != null && upstreamCreatorId !== found.creatorId;
    const dirty =
      found.title !== mapped.title ||
      found.status !== mapped.status ||
      found.priority !== mapped.priority ||
      !sameDate(found.dueDate, mapped.dueDate) ||
      !sameDate(found.completedAt, mapped.completedAt) ||
      !sameDate(found.startedAt, mapped.startedAt) ||
      (found.description ?? null) !== (mapped.description ?? null) ||
      (found.assigneeId ?? null) !== (assigneeId ?? null) ||
      (found.bitrixCreatedById ?? null) !== (mapped.bitrixCreatedById ?? null) ||
      (found.bitrixResponsibleId ?? null) !== (mapped.bitrixResponsibleId ?? null) ||
      creatorChanged;
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
          tags: mapped.tags,
          bitrixCreatedById: mapped.bitrixCreatedById ?? null,
          bitrixResponsibleId: mapped.bitrixResponsibleId ?? null,
          ...(creatorChanged ? { creatorId: upstreamCreatorId! } : {}),
        },
      });
      stats.updated++;
    }
    await syncBitrixTagsToProject(prisma, projectId, found.id, mapped.tags);
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
      tags: mapped.tags,
      bitrixCreatedById: mapped.bitrixCreatedById ?? null,
      bitrixResponsibleId: mapped.bitrixResponsibleId ?? null,
    },
    select: { id: true },
  });
  await syncBitrixTagsToProject(prisma, projectId, created.id, mapped.tags);
  stats.created++;
  return created.id;
}

/**
 * For every Bitrix tag string seen on this task, ensure a Tag row
 * exists in the project (marked externalSource='bitrix24' so we can
 * tell native vs mirrored apart) and attach the TaskTag link. Tags
 * removed in Bitrix are unlinked here too — the Tag row stays for
 * other tasks that may still reference it.
 */
async function syncBitrixTagsToProject(
  prisma: PrismaClient,
  projectId: string,
  taskId: string,
  tagNames: string[],
): Promise<void> {
  const cleanNames = Array.from(
    new Set(tagNames.map((s) => s.trim()).filter(Boolean)),
  );

  // Resolve / create Tag rows for each unique name.
  const tagIds: string[] = [];
  for (const name of cleanNames) {
    const slug = slugifyTag(name);
    const tag = await prisma.tag.upsert({
      where: { projectId_slug: { projectId, slug } },
      create: {
        projectId,
        name: name.slice(0, 40),
        slug,
        color: pickTagColor(name),
        externalSource: 'bitrix24',
      },
      update: {},
      select: { id: true },
    });
    tagIds.push(tag.id);
  }

  // Diff: add missing TaskTag links, remove ones not in the new set.
  const existing = await prisma.taskTag.findMany({
    where: { taskId },
    select: { tagId: true },
  });
  const existingIds = new Set(existing.map((r) => r.tagId));
  const targetIds = new Set(tagIds);

  const toAdd = tagIds.filter((id) => !existingIds.has(id));
  const toRemove = [...existingIds].filter((id) => !targetIds.has(id));

  if (toAdd.length > 0) {
    await prisma.taskTag.createMany({
      data: toAdd.map((tagId) => ({ taskId, tagId })),
      skipDuplicates: true,
    });
  }
  if (toRemove.length > 0) {
    await prisma.taskTag.deleteMany({
      where: { taskId, tagId: { in: toRemove } },
    });
  }
}

function slugifyTag(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-zа-я0-9]+/giu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'tag'
  );
}

function pickTagColor(name: string): string {
  const palette = [
    '#94a3b8',
    '#3b82f6',
    '#8b5cf6',
    '#ec4899',
    '#ef4444',
    '#f97316',
    '#eab308',
    '#22c55e',
    '#14b8a6',
    '#06b6d4',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length] ?? '#94a3b8';
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
 * Ensure a MINE project exists for personal tasks of one Bitrix user.
 * Marked synthetic via (externalSource='bitrix24', externalId='__personal__<bxId>')
 * so each user gets their own MINE row, owned by them — not collapsed
 * onto a single shared admin-owned bucket.
 */
async function ensurePersonalProject(
  prisma: PrismaClient,
  ownerId: string | null,
  bitrixUserId: string,
): Promise<string | null> {
  if (!ownerId) return null;
  const PERSONAL_EXT_ID = `__personal__${bitrixUserId}`;
  const existing = await prisma.project.findUnique({
    where: {
      externalSource_externalId: {
        externalSource: 'bitrix24',
        externalId: PERSONAL_EXT_ID,
      },
    },
    select: { id: true, ownerId: true },
  });
  if (existing) {
    // Repair ownership if a stale row from the legacy single-MINE era
    // points at someone else.
    if (existing.ownerId !== ownerId) {
      await prisma.project.update({
        where: { id: existing.id },
        data: { ownerId },
      });
    }
    return existing.id;
  }

  // Need a unique key. Try MINE first, then MINE2..MINE99 — keeps
  // legacy hand-made MINE projects untouched.
  let key = 'MINE';
  for (let i = 2; i < 100; i++) {
    if (!(await prisma.project.findUnique({ where: { key }, select: { id: true } }))) break;
    key = `MINE${i}`;
  }
  const created = await prisma.project.create({
    data: {
      key,
      name: 'Личные задачи (Bitrix24)',
      description: 'Задачи без рабочей группы — синхронизируются из Bitrix24.',
      ownerId,
      externalSource: 'bitrix24',
      externalId: PERSONAL_EXT_ID,
      members: {
        create: { userId: ownerId, role: 'LEAD' },
      },
    },
    select: { id: true },
  });
  return created.id;
}
