'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@giper/db';
import { taskListFilterSchema } from '@giper/shared';
import { requireAuth } from '@/lib/auth';
import { canEditProject, canEditTaskInternal } from '@/lib/permissions';
import { getEffectiveCapsForProject } from '@/lib/capabilities';
import { listTasksForProject } from '@/lib/tasks';
import { setTaskSprint } from '@/lib/tasks/setTaskSprint';
import { DomainError } from '@/lib/errors';

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  if (!DATE_RE.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function loadProjectForSprint(sprintId: string) {
  return prisma.sprint.findUnique({
    where: { id: sprintId },
    select: {
      id: true,
      projectId: true,
      status: true,
      project: { select: { key: true, ownerId: true, members: { select: { userId: true, role: true } } } },
    },
  });
}

/** Create a PLANNED sprint. Gated on project-edit permission. */
export async function createSprintAction(
  projectKey: string,
  input: { name: string; goal?: string; startDate?: string; endDate?: string },
): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  const project = await prisma.project.findUnique({
    where: { key: projectKey },
    select: { id: true, ownerId: true, members: { select: { userId: true, role: true } } },
  });
  if (!project) return { ok: false, error: { code: 'NOT_FOUND', message: 'Проект не найден' } };
  if (
    !canEditProject(
      { id: me.id, role: me.role },
      project,
      await getEffectiveCapsForProject({ id: me.id, role: me.role }, project.id),
    )
  ) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }
  if (input.name.trim().length < 2) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Название ≥ 2 символов' } };
  }
  const sprint = await prisma.sprint.create({
    data: {
      projectId: project.id,
      name: input.name.trim().slice(0, 120),
      goal: input.goal?.trim().slice(0, 2000) || null,
      startDate: parseDate(input.startDate),
      endDate: parseDate(input.endDate),
      createdById: me.id,
    },
    select: { id: true },
  });
  revalidatePath(`/projects/${projectKey}/sprints`);
  return { ok: true, data: { id: sprint.id } };
}

/** Edit a sprint's name/goal/dates. */
export async function updateSprintAction(
  sprintId: string,
  input: { name: string; goal?: string; startDate?: string; endDate?: string },
): Promise<ActionResult> {
  const me = await requireAuth();
  const s = await loadProjectForSprint(sprintId);
  if (!s) return { ok: false, error: { code: 'NOT_FOUND', message: 'Спринт не найден' } };
  if (
    !canEditProject(
      { id: me.id, role: me.role },
      s.project,
      await getEffectiveCapsForProject({ id: me.id, role: me.role }, s.projectId),
    )
  ) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }
  if (input.name.trim().length < 2) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Название ≥ 2 символов' } };
  }
  await prisma.sprint.update({
    where: { id: sprintId },
    data: {
      name: input.name.trim().slice(0, 120),
      goal: input.goal?.trim().slice(0, 2000) || null,
      startDate: parseDate(input.startDate),
      endDate: parseDate(input.endDate),
    },
  });
  revalidatePath(`/projects/${s.project.key}/sprints`);
  return { ok: true };
}

/**
 * Promote a sprint to ACTIVE. Enforces ONE active per project in a transaction:
 * any currently-ACTIVE sprint is auto-CLOSED first. (No DB partial index — CI
 * uses `prisma db push` which can't express one.)
 */
export async function startSprintAction(sprintId: string): Promise<ActionResult> {
  const me = await requireAuth();
  const s = await loadProjectForSprint(sprintId);
  if (!s) return { ok: false, error: { code: 'NOT_FOUND', message: 'Спринт не найден' } };
  if (
    !canEditProject(
      { id: me.id, role: me.role },
      s.project,
      await getEffectiveCapsForProject({ id: me.id, role: me.role }, s.projectId),
    )
  ) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }
  await prisma.$transaction([
    prisma.sprint.updateMany({
      where: { projectId: s.projectId, status: 'ACTIVE', id: { not: sprintId } },
      data: { status: 'CLOSED', closedAt: new Date() },
    }),
    prisma.sprint.update({ where: { id: sprintId }, data: { status: 'ACTIVE' } }),
  ]);
  revalidatePath(`/projects/${s.project.key}/sprints`);
  return { ok: true };
}

/**
 * Close a sprint. Incomplete cards (internalStatus NOT DONE/CANCELED) are
 * carried to the next PLANNED sprint in the project (or to the backlog if
 * none). Done/canceled cards keep their sprintId. Transactional.
 */
export async function closeSprintAction(sprintId: string): Promise<ActionResult<{ carried: number }>> {
  const me = await requireAuth();
  const s = await loadProjectForSprint(sprintId);
  if (!s) return { ok: false, error: { code: 'NOT_FOUND', message: 'Спринт не найден' } };
  if (
    !canEditProject(
      { id: me.id, role: me.role },
      s.project,
      await getEffectiveCapsForProject({ id: me.id, role: me.role }, s.projectId),
    )
  ) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }

  const nextPlanned = await prisma.sprint.findFirst({
    where: { projectId: s.projectId, status: 'PLANNED', id: { not: sprintId } },
    orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  const carryTo = nextPlanned?.id ?? null;

  const incomplete = await prisma.task.findMany({
    where: { sprintId, internalStatus: { notIn: ['DONE', 'CANCELED'] } },
    select: { id: true },
  });
  const ids = incomplete.map((t) => t.id);

  await prisma.$transaction([
    ...(ids.length
      ? [prisma.task.updateMany({ where: { id: { in: ids } }, data: { sprintId: carryTo } })]
      : []),
    prisma.sprint.update({ where: { id: sprintId }, data: { status: 'CLOSED', closedAt: new Date() } }),
  ]);
  revalidatePath(`/projects/${s.project.key}/sprints`);
  return { ok: true, data: { carried: ids.length } };
}

/** Delete a sprint. Its cards return to the backlog (FK SetNull). */
export async function deleteSprintAction(sprintId: string): Promise<ActionResult> {
  const me = await requireAuth();
  const s = await loadProjectForSprint(sprintId);
  if (!s) return { ok: true };
  if (
    !canEditProject(
      { id: me.id, role: me.role },
      s.project,
      await getEffectiveCapsForProject({ id: me.id, role: me.role }, s.projectId),
    )
  ) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }
  try {
    await prisma.sprint.delete({ where: { id: sprintId } });
  } catch {
    return { ok: false, error: { code: 'DB_ERROR', message: 'Не удалось удалить спринт' } };
  }
  revalidatePath(`/projects/${s.project.key}/sprints`);
  return { ok: true };
}

/**
 * Put a task into a sprint (or back to the backlog with sprintId=null). Local-
 * only field — gated by canEditTaskInternal (works on Bitrix-mirror tasks),
 * never the strict canEditTask. The sprint must belong to the task's project.
 */
export async function assignTaskToSprintAction(
  taskId: string,
  sprintId: string | null,
): Promise<ActionResult> {
  const me = await requireAuth();
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      projectId: true,
      creatorId: true,
      assigneeId: true,
      project: { select: { key: true, ownerId: true, members: { select: { userId: true, role: true } } } },
    },
  });
  if (!task) return { ok: false, error: { code: 'NOT_FOUND', message: 'Задача не найдена' } };
  if (
    !canEditTaskInternal(
      { id: me.id, role: me.role },
      task,
      await getEffectiveCapsForProject({ id: me.id, role: me.role }, task.projectId),
    )
  ) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }
  if (sprintId) {
    const sprint = await prisma.sprint.findUnique({
      where: { id: sprintId },
      select: { projectId: true },
    });
    if (!sprint || sprint.projectId !== task.projectId) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Спринт не из этого проекта' } };
    }
  }
  await prisma.task.update({ where: { id: taskId }, data: { sprintId } });
  revalidatePath(`/projects/${task.project.key}/sprints`);
  return { ok: true };
}

// ---- Sprint planning (add/remove tasks from a sprint, in one place) --------

export type SprintPlanningTask = {
  id: string;
  number: number;
  title: string;
  internalStatus: string;
  /** Whether the task is currently in THIS sprint. */
  inSprint: boolean;
};

/**
 * Candidate tasks for the sprint-planning dialog: the project's tasks the user
 * can see (reuses listTasksForProject — same per-stake visibility/leak-guard +
 * `q` search), each flagged with whether it's already in `sprintId`. Capped to
 * one page; `hasMore` hints the user to narrow the search.
 */
export async function listSprintPlanningTasksAction(
  projectKey: string,
  sprintId: string,
  query: string,
): Promise<ActionResult<{ items: SprintPlanningTask[]; hasMore: boolean }>> {
  const me = await requireAuth();
  // Defense-in-depth: the sprint must belong to the project named by projectKey,
  // so the inSprint flag is meaningful and a foreign sprintId can't be probed.
  const sprint = await prisma.sprint.findUnique({
    where: { id: sprintId },
    select: { project: { select: { key: true } } },
  });
  if (!sprint || sprint.project.key !== projectKey) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Спринт не найден в этом проекте' } };
  }
  const q = (typeof query === 'string' ? query : '').trim();
  const filter = taskListFilterSchema.parse({ q: q || undefined });
  try {
    const res = await listTasksForProject(projectKey, filter, { id: me.id, role: me.role });
    const items: SprintPlanningTask[] = res.items.map((t) => ({
      id: t.id,
      number: t.number,
      title: t.title,
      internalStatus: t.internalStatus,
      inSprint: t.sprintId === sprintId,
    }));
    return { ok: true, data: { items, hasMore: res.total > res.items.length } };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: { code: e.code, message: 'Нет доступа' } };
    throw e;
  }
}

/** Hard cap per planning save — keeps one action from looping unbounded work. */
const MAX_PLANNING = 200;

/**
 * Apply sprint membership changes from the planning dialog: add `addIds` to the
 * sprint and clear `removeIds` back to the backlog. Authorization is PER TASK
 * (each id routed through the gated `setTaskSprint` — canEditTaskInternal + the
 * sprint must belong to the task's project); a task the caller can't touch is
 * counted failed and skipped, the batch never aborts. Returns a tally.
 */
export async function updateSprintMembershipAction(
  sprintId: string,
  addIds: string[],
  removeIds: string[],
): Promise<ActionResult<{ added: number; removed: number; failed: number }>> {
  const me = await requireAuth();

  const idSchema = z.array(z.string().min(1));
  const addParsed = idSchema.safeParse(addIds);
  const removeParsed = idSchema.safeParse(removeIds);
  if (!addParsed.success || !removeParsed.success) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Некорректный список задач' } };
  }
  const add = Array.from(new Set(addParsed.data));
  const remove = Array.from(new Set(removeParsed.data)).filter((id) => !add.includes(id));
  if (add.length + remove.length === 0) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Нет изменений' } };
  }
  if (add.length + remove.length > MAX_PLANNING) {
    return { ok: false, error: { code: 'VALIDATION', message: `Не более ${MAX_PLANNING} задач за раз` } };
  }

  const user = { id: me.id, role: me.role };
  let added = 0;
  let removed = 0;
  let failed = 0;
  let projectKey: string | null = null;

  for (const id of add) {
    try {
      await setTaskSprint(id, sprintId, user);
      added++;
    } catch (e) {
      failed++;
      if (!(e instanceof DomainError)) console.error('updateSprintMembershipAction: add failed', id, e);
    }
  }
  for (const id of remove) {
    try {
      await setTaskSprint(id, null, user);
      removed++;
    } catch (e) {
      failed++;
      if (!(e instanceof DomainError)) console.error('updateSprintMembershipAction: remove failed', id, e);
    }
  }

  // Resolve the project key from the sprint for a targeted revalidate (best-effort).
  const sprint = await prisma.sprint
    .findUnique({ where: { id: sprintId }, select: { project: { select: { key: true } } } })
    .catch(() => null);
  projectKey = sprint?.project.key ?? null;
  if (projectKey) {
    revalidatePath(`/projects/${projectKey}/sprints`);
    revalidatePath(`/projects/${projectKey}/board`);
  } else {
    revalidatePath('/projects', 'layout');
  }
  return { ok: true, data: { added, removed, failed } };
}
