'use server';

import { revalidatePath } from 'next/cache';
import { prisma, type TaskStatus, type StatusCategory } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { canEditProject } from '@/lib/permissions';
import { getEffectiveCapsForProject } from '@/lib/capabilities';
import { categoryToTaskStatus } from '@/lib/status/category';
import { STATUS_SEED } from '@/lib/status/backfillStatuses';
import { setInternalStatus } from '@/lib/tasks/setInternalStatus';
import type { ActionResult } from './projects';

const VALID_STATUSES: readonly TaskStatus[] = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'REVIEW',
  'BLOCKED',
  'DONE',
  'CANCELED',
];

const MAX_NAME = 60;
const MAX_WIP = 999;

export type BoardColumnInput = {
  status: TaskStatus;
  name: string;
  /** Card-count WIP limit; null = no limit. */
  wipLimit: number | null;
  /** Left → right display order. */
  order: number;
};

/**
 * Upsert a project's board columns (name, order, per-column WIP) keyed by
 * status. Columns map 1:1 to TaskStatus (`@@unique[projectId, status]`), so
 * this both creates columns for a project still on synthesized defaults and
 * updates existing ones in a single transaction.
 *
 * Permissions: ADMIN, project owner, or project LEAD — same gate as other
 * board/project-meta edits.
 */
export async function updateBoardColumnsAction(
  projectId: string,
  columns: BoardColumnInput[],
): Promise<ActionResult> {
  const me = await requireAuth();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      key: true,
      ownerId: true,
      members: { select: { userId: true, role: true } },
    },
  });
  if (!project) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Проект не найден' } };
  }
  if (
    !canEditProject(
      { id: me.id, role: me.role },
      project,
      await getEffectiveCapsForProject({ id: me.id, role: me.role }, projectId),
    )
  ) {
    return {
      ok: false,
      error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' },
    };
  }

  // Sanitize: one entry per valid status, trimmed non-empty name, WIP a
  // positive int under the cap (or null), integer order.
  const seen = new Set<TaskStatus>();
  const clean: BoardColumnInput[] = [];
  for (const c of columns) {
    if (!VALID_STATUSES.includes(c.status) || seen.has(c.status)) continue;
    const name = (c.name ?? '').trim();
    if (name.length === 0 || name.length > MAX_NAME) {
      return {
        ok: false,
        error: { code: 'VALIDATION', message: `Название колонки: 1–${MAX_NAME} символов` },
      };
    }
    seen.add(c.status);
    let wipLimit: number | null = null;
    if (c.wipLimit != null) {
      const n = Math.floor(Number(c.wipLimit));
      if (Number.isFinite(n) && n > 0 && n <= MAX_WIP) wipLimit = n;
    }
    const order = Number.isFinite(c.order) ? Math.floor(Number(c.order)) : 0;
    clean.push({ status: c.status, name, wipLimit, order });
  }
  if (clean.length === 0) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Нет колонок для сохранения' } };
  }

  // S6 dropped the @@unique[projectId,status], so we can no longer upsert by
  // that compound key. This legacy 1:1 editor (project settings) updates the
  // first column of each status if present, else creates one — match the
  // existing default column by (projectId,status), preferring the lowest order.
  try {
    const existing = await prisma.boardColumn.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
      select: { id: true, status: true },
    });
    const idByStatus = new Map<TaskStatus, string>();
    for (const col of existing) {
      if (!idByStatus.has(col.status)) idByStatus.set(col.status, col.id);
    }
    await prisma.$transaction(
      clean.map((c) => {
        const existingId = idByStatus.get(c.status);
        return existingId
          ? prisma.boardColumn.update({
              where: { id: existingId },
              data: { name: c.name, order: c.order, wipLimit: c.wipLimit },
            })
          : prisma.boardColumn.create({
              data: {
                projectId,
                status: c.status,
                name: c.name,
                order: c.order,
                wipLimit: c.wipLimit,
              },
            });
      }),
    );
  } catch (e) {
    console.error('updateBoardColumnsAction', e);
    return { ok: false, error: { code: 'INTERNAL', message: 'Не удалось сохранить колонки' } };
  }

  revalidatePath(`/projects/${project.key}`);
  revalidatePath(`/projects/${project.key}/board`);
  revalidatePath(`/projects/${project.key}/settings`);
  return { ok: true };
}

export type BoardSwimlaneInput = {
  /** Existing swimlane id, or null to create a new one. */
  id: string | null;
  name: string;
  /** Card-count WIP limit for the lane; null = no limit. */
  wipLimit: number | null;
  /** Top → bottom display order. */
  order: number;
};

/**
 * Reconcile a project's board swimlanes against the submitted set: update
 * existing lanes (matched by id), create new ones (id === null), and delete
 * lanes that are no longer present. Deleting a lane sets its tasks'
 * `swimlaneId` to null via the FK (onDelete: SetNull) — the cards fall back to
 * the implicit "no lane".
 *
 * Permissions: ADMIN, project owner, or LEAD.
 */
export async function updateBoardSwimlanesAction(
  projectId: string,
  swimlanes: BoardSwimlaneInput[],
): Promise<ActionResult> {
  const me = await requireAuth();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      key: true,
      ownerId: true,
      members: { select: { userId: true, role: true } },
    },
  });
  if (!project) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Проект не найден' } };
  }
  if (
    !canEditProject(
      { id: me.id, role: me.role },
      project,
      await getEffectiveCapsForProject({ id: me.id, role: me.role }, projectId),
    )
  ) {
    return {
      ok: false,
      error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' },
    };
  }

  // Only ids that already belong to this project may be updated; any other id
  // is treated as a new lane (guards against cross-project id injection).
  const existing = await prisma.boardSwimlane.findMany({
    where: { projectId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((s) => s.id));

  const clean: BoardSwimlaneInput[] = [];
  const keptIds = new Set<string>();
  for (const s of swimlanes) {
    const name = (s.name ?? '').trim();
    if (name.length === 0 || name.length > MAX_NAME) {
      return {
        ok: false,
        error: { code: 'VALIDATION', message: `Название дорожки: 1–${MAX_NAME} символов` },
      };
    }
    let wipLimit: number | null = null;
    if (s.wipLimit != null) {
      const n = Math.floor(Number(s.wipLimit));
      if (Number.isFinite(n) && n > 0 && n <= MAX_WIP) wipLimit = n;
    }
    const order = Number.isFinite(s.order) ? Math.floor(Number(s.order)) : 0;
    const id = s.id && existingIds.has(s.id) ? s.id : null;
    if (id) keptIds.add(id);
    clean.push({ id, name, wipLimit, order });
  }

  const toDelete = existing.filter((e) => !keptIds.has(e.id)).map((e) => e.id);

  try {
    await prisma.$transaction([
      ...clean.map((s) =>
        s.id
          ? prisma.boardSwimlane.update({
              where: { id: s.id },
              data: { name: s.name, order: s.order, wipLimit: s.wipLimit },
            })
          : prisma.boardSwimlane.create({
              data: { projectId, name: s.name, order: s.order, wipLimit: s.wipLimit },
            }),
      ),
      ...(toDelete.length > 0
        ? [prisma.boardSwimlane.deleteMany({ where: { id: { in: toDelete } } })]
        : []),
    ]);
  } catch (e) {
    console.error('updateBoardSwimlanesAction', e);
    return { ok: false, error: { code: 'INTERNAL', message: 'Не удалось сохранить дорожки' } };
  }

  revalidatePath(`/projects/${project.key}`);
  revalidatePath(`/projects/${project.key}/board`);
  revalidatePath(`/projects/${project.key}/settings`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// In-board swimlane management (instant-persist, used by the board itself —
// reorder by drag, inline rename, add lane). Same edit gate as the bulk form.
// ---------------------------------------------------------------------------

/** Resolve a project the caller may edit, or a ready-to-return error. */
async function editableProjectOrError(
  projectId: string,
): Promise<{ ok: true; key: string } | { ok: false; error: { code: string; message: string } }> {
  const me = await requireAuth();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { key: true, ownerId: true, members: { select: { userId: true, role: true } } },
  });
  if (!project) return { ok: false, error: { code: 'NOT_FOUND', message: 'Проект не найден' } };
  if (
    !canEditProject(
      { id: me.id, role: me.role },
      project,
      await getEffectiveCapsForProject({ id: me.id, role: me.role }, projectId),
    )
  ) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }
  return { ok: true, key: project.key };
}

/** Reorder a project's swimlanes by id (board drag). Foreign ids are ignored. */
export async function reorderBoardSwimlanesAction(
  projectId: string,
  orderedIds: string[],
): Promise<ActionResult> {
  const gate = await editableProjectOrError(projectId);
  if (!gate.ok) return gate;
  const own = await prisma.boardSwimlane.findMany({ where: { projectId }, select: { id: true } });
  const ownSet = new Set(own.map((s) => s.id));
  const ids = orderedIds.filter((id) => ownSet.has(id));
  try {
    await prisma.$transaction(
      ids.map((id, i) => prisma.boardSwimlane.update({ where: { id }, data: { order: i } })),
    );
  } catch (e) {
    console.error('reorderBoardSwimlanesAction', e);
    return { ok: false, error: { code: 'INTERNAL', message: 'Не удалось изменить порядок дорожек' } };
  }
  revalidatePath(`/projects/${gate.key}/board`);
  return { ok: true };
}

/** Rename one swimlane (inline edit in the board). */
export async function renameBoardSwimlaneAction(
  swimlaneId: string,
  name: string,
): Promise<ActionResult> {
  const me = await requireAuth();
  const lane = await prisma.boardSwimlane.findUnique({
    where: { id: swimlaneId },
    select: {
      projectId: true,
      project: { select: { key: true, ownerId: true, members: { select: { userId: true, role: true } } } },
    },
  });
  if (!lane) return { ok: false, error: { code: 'NOT_FOUND', message: 'Дорожка не найдена' } };
  if (
    !canEditProject(
      { id: me.id, role: me.role },
      lane.project,
      await getEffectiveCapsForProject({ id: me.id, role: me.role }, lane.projectId),
    )
  ) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }
  const clean = (typeof name === 'string' ? name : '').trim();
  if (clean.length === 0 || clean.length > MAX_NAME) {
    return { ok: false, error: { code: 'VALIDATION', message: `Название дорожки: 1–${MAX_NAME} символов` } };
  }
  await prisma.boardSwimlane.update({ where: { id: swimlaneId }, data: { name: clean } });
  revalidatePath(`/projects/${lane.project.key}/board`);
  return { ok: true };
}

/** Create a swimlane at the end (＋ in the board). */
export async function createBoardSwimlaneAction(
  projectId: string,
  name: string,
): Promise<ActionResult<{ id: string }>> {
  const gate = await editableProjectOrError(projectId);
  if (!gate.ok) return gate;
  const clean = (typeof name === 'string' ? name : '').trim();
  if (clean.length === 0 || clean.length > MAX_NAME) {
    return { ok: false, error: { code: 'VALIDATION', message: `Название дорожки: 1–${MAX_NAME} символов` } };
  }
  const max = await prisma.boardSwimlane.aggregate({ where: { projectId }, _max: { order: true } });
  const lane = await prisma.boardSwimlane.create({
    data: { projectId, name: clean, order: (max._max.order ?? -1) + 1 },
    select: { id: true },
  });
  revalidatePath(`/projects/${gate.key}/board`);
  return { ok: true, data: { id: lane.id } };
}

/**
 * Move a single task into a swimlane (or clear it with null). Used by the board
 * when a card is dragged across lanes. Permissioned like a board move: the
 * task's project must be editable by the caller — reuse canEditProject via the
 * task's project.
 */
export async function setTaskSwimlaneAction(
  taskId: string,
  swimlaneId: string | null,
): Promise<ActionResult> {
  const me = await requireAuth();
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      projectId: true,
      project: {
        select: {
          key: true,
          ownerId: true,
          members: { select: { userId: true, role: true } },
        },
      },
    },
  });
  if (!task) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Задача не найдена' } };
  }
  if (
    !canEditProject(
      { id: me.id, role: me.role },
      task.project,
      await getEffectiveCapsForProject({ id: me.id, role: me.role }, task.projectId),
    )
  ) {
    return {
      ok: false,
      error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' },
    };
  }
  // A non-null lane must belong to the same project.
  if (swimlaneId) {
    const lane = await prisma.boardSwimlane.findUnique({
      where: { id: swimlaneId },
      select: { projectId: true },
    });
    if (!lane || lane.projectId !== task.projectId) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Дорожка не найдена' } };
    }
  }
  try {
    await prisma.task.update({ where: { id: taskId }, data: { swimlaneId } });
  } catch (e) {
    console.error('setTaskSwimlaneAction', e);
    return { ok: false, error: { code: 'INTERNAL', message: 'Не удалось переместить задачу' } };
  }
  revalidatePath(`/projects/${task.project.key}/board`);
  return { ok: true };
}

// ===========================================================================
// S6 — free-form board columns. Each column is a named bucket backed by a
// per-project Status row carrying its category. Multiple columns can share a
// category (the S6 migration drops the old @@unique[projectId,status]). Gated by
// the same edit gate as swimlanes; surfaced only when freeFormColumnsEnabled.
// ===========================================================================

/** Category → seed color (reuse the 7-status palette for free-form columns). */
const CATEGORY_COLOR = Object.fromEntries(
  STATUS_SEED.map((s) => [s.category, s.color]),
) as Record<StatusCategory, string>;

const VALID_CATEGORIES = new Set<StatusCategory>(STATUS_SEED.map((s) => s.category));

/** A Status name unique within a project (Status has @@unique[projectId,name]). */
async function uniqueStatusName(projectId: string, base: string): Promise<string> {
  let name = base;
  for (let i = 2; i < 1000; i++) {
    const hit = await prisma.status.findUnique({
      where: { projectId_name: { projectId, name } },
      select: { id: true },
    });
    if (!hit) return name;
    name = `${base} ${i}`;
  }
  return base;
}

/**
 * Create a free-form board column (＋ in the board). Auto-creates a per-project
 * Status of the chosen category (the column's bucket) and a BoardColumn linked
 * to it, appended at the end. Returns the new column + status ids.
 */
export async function createBoardColumnAction(
  projectId: string,
  name: string,
  category: StatusCategory,
): Promise<ActionResult<{ columnId: string; statusId: string }>> {
  const gate = await editableProjectOrError(projectId);
  if (!gate.ok) return gate;
  const clean = (typeof name === 'string' ? name : '').trim();
  if (clean.length === 0 || clean.length > MAX_NAME) {
    return { ok: false, error: { code: 'VALIDATION', message: `Название колонки: 1–${MAX_NAME} символов` } };
  }
  if (!VALID_CATEGORIES.has(category)) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Неверная категория статуса' } };
  }
  try {
    const data = await prisma.$transaction(async (tx) => {
      const statusName = await uniqueStatusName(projectId, clean);
      const sMax = await tx.status.aggregate({ where: { projectId, category }, _max: { order: true } });
      const status = await tx.status.create({
        data: {
          projectId,
          name: statusName,
          category,
          order: (sMax._max.order ?? -1) + 1,
          color: CATEGORY_COLOR[category] ?? null,
          isDefault: false,
        },
        select: { id: true },
      });
      const cMax = await tx.boardColumn.aggregate({ where: { projectId }, _max: { order: true } });
      const col = await tx.boardColumn.create({
        data: {
          projectId,
          name: clean,
          status: categoryToTaskStatus(category),
          statusId: status.id,
          color: CATEGORY_COLOR[category] ?? null,
          order: (cMax._max.order ?? -1) + 1,
        },
        select: { id: true },
      });
      return { columnId: col.id, statusId: status.id };
    });
    revalidatePath(`/projects/${gate.key}/board`);
    return { ok: true, data };
  } catch (e) {
    console.error('createBoardColumnAction', e);
    return { ok: false, error: { code: 'INTERNAL', message: 'Не удалось создать колонку' } };
  }
}

/** Resolve a column the caller may edit, or a ready-to-return error. */
async function editableColumnOrError(
  columnId: string,
): Promise<
  | { ok: true; column: { projectId: string; status: TaskStatus; statusId: string | null; key: string } }
  | { ok: false; error: { code: string; message: string } }
> {
  const me = await requireAuth();
  const col = await prisma.boardColumn.findUnique({
    where: { id: columnId },
    select: {
      projectId: true,
      status: true,
      statusId: true,
      project: { select: { key: true, ownerId: true, members: { select: { userId: true, role: true } } } },
    },
  });
  if (!col) return { ok: false, error: { code: 'NOT_FOUND', message: 'Колонка не найдена' } };
  if (
    !canEditProject(
      { id: me.id, role: me.role },
      col.project,
      await getEffectiveCapsForProject({ id: me.id, role: me.role }, col.projectId),
    )
  ) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }
  return {
    ok: true,
    column: { projectId: col.projectId, status: col.status, statusId: col.statusId, key: col.project.key },
  };
}

/** Rename one board column (inline edit); the backing status name follows. */
export async function renameBoardColumnAction(columnId: string, name: string): Promise<ActionResult> {
  const gate = await editableColumnOrError(columnId);
  if (!gate.ok) return gate;
  const clean = (typeof name === 'string' ? name : '').trim();
  if (clean.length === 0 || clean.length > MAX_NAME) {
    return { ok: false, error: { code: 'VALIDATION', message: `Название колонки: 1–${MAX_NAME} символов` } };
  }
  await prisma.boardColumn.update({ where: { id: columnId }, data: { name: clean } });
  if (gate.column.statusId) {
    const statusName = await uniqueStatusName(gate.column.projectId, clean);
    await prisma.status
      .update({ where: { id: gate.column.statusId }, data: { name: statusName } })
      .catch(() => {});
  }
  revalidatePath(`/projects/${gate.column.key}/board`);
  return { ok: true };
}

/**
 * Delete a board column. Refuses the LAST column of its category (so cards in
 * that category keep a home — the board's status fallback needs a sibling).
 * Cards' columnId → null (SetNull); the backing free-form status is archived
 * (never hard-deleted — a task may still reference it via internalStatusId).
 */
export async function deleteBoardColumnAction(columnId: string): Promise<ActionResult> {
  const gate = await editableColumnOrError(columnId);
  if (!gate.ok) return gate;
  const sameCategory = await prisma.boardColumn.count({
    where: { projectId: gate.column.projectId, status: gate.column.status },
  });
  if (sameCategory <= 1) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Нельзя удалить последнюю колонку этой категории' } };
  }
  try {
    await prisma.$transaction(async (tx) => {
      await tx.boardColumn.delete({ where: { id: columnId } });
      if (gate.column.statusId) {
        await tx.status
          .update({ where: { id: gate.column.statusId }, data: { archivedAt: new Date(), isDefault: false } })
          .catch(() => {});
      }
    });
  } catch (e) {
    console.error('deleteBoardColumnAction', e);
    return { ok: false, error: { code: 'INTERNAL', message: 'Не удалось удалить колонку' } };
  }
  revalidatePath(`/projects/${gate.column.key}/board`);
  return { ok: true };
}

/** Reorder a project's columns by id (board drag). Foreign ids ignored. */
export async function reorderBoardColumnsAction(
  projectId: string,
  orderedIds: string[],
): Promise<ActionResult> {
  const gate = await editableProjectOrError(projectId);
  if (!gate.ok) return gate;
  const own = await prisma.boardColumn.findMany({ where: { projectId }, select: { id: true } });
  const ownSet = new Set(own.map((c) => c.id));
  const ids = orderedIds.filter((id) => ownSet.has(id));
  try {
    await prisma.$transaction(
      ids.map((id, i) => prisma.boardColumn.update({ where: { id }, data: { order: i } })),
    );
  } catch (e) {
    console.error('reorderBoardColumnsAction', e);
    return { ok: false, error: { code: 'INTERNAL', message: 'Не удалось изменить порядок колонок' } };
  }
  revalidatePath(`/projects/${gate.key}/board`);
  return { ok: true };
}

/**
 * Move a card into a specific (free-form) column. When the column's category
 * differs from the card's internalStatus, run the workflow-gated status core
 * first (transition rules + side effects); then pin the exact column + its
 * status (overriding the deterministic category default the core writes). A
 * same-category move just re-pins the column.
 */
export async function setTaskColumnAction(taskId: string, columnId: string): Promise<ActionResult> {
  const me = await requireAuth();
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      projectId: true,
      internalStatus: true,
      creatorId: true,
      assigneeId: true,
      project: {
        select: { key: true, ownerId: true, members: { select: { userId: true, role: true } } },
      },
    },
  });
  if (!task) return { ok: false, error: { code: 'NOT_FOUND', message: 'Задача не найдена' } };
  // Board move gate — same stakeholder/leadership predicate as setInternalStatus
  // (the status core). The cross-category branch below re-checks it inside
  // setInternalStatus, but the same-category fast path skips the core, so gate
  // here too or it would be an unauthenticated-edit (IDOR) hole.
  const allow =
    me.role === 'ADMIN' ||
    me.role === 'PM' ||
    task.creatorId === me.id ||
    task.assigneeId === me.id ||
    task.project.ownerId === me.id ||
    task.project.members.some((m) => m.userId === me.id && m.role === 'LEAD');
  if (!allow) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }
  const col = await prisma.boardColumn.findUnique({
    where: { id: columnId },
    select: { projectId: true, status: true, statusId: true },
  });
  if (!col || col.projectId !== task.projectId) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Колонка не найдена' } };
  }
  try {
    if (task.internalStatus !== col.status) {
      // Category change → the workflow-gated core enforces the transition + runs
      // side effects (it also rejects a forbidden move / a DONE without an итог).
      await setInternalStatus(taskId, col.status, me);
    }
    await prisma.task.update({
      where: { id: taskId },
      data: { columnId, ...(col.statusId ? { internalStatusId: col.statusId } : {}) },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Не удалось переместить задачу';
    return { ok: false, error: { code: 'VALIDATION', message } };
  }
  revalidatePath(`/projects/${task.project.key}/board`);
  return { ok: true };
}

/** Toggle the per-project free-form-columns mode (the inline column-management UI). */
export async function setFreeFormColumnsEnabledAction(
  projectId: string,
  enabled: boolean,
): Promise<ActionResult> {
  const gate = await editableProjectOrError(projectId);
  if (!gate.ok) return gate;
  await prisma.project.update({
    where: { id: projectId },
    data: { freeFormColumnsEnabled: Boolean(enabled) },
  });
  revalidatePath(`/projects/${gate.key}/board`);
  revalidatePath(`/projects/${gate.key}/settings`);
  return { ok: true };
}

export type BoardSubColumnInput = {
  id: string | null;
  name: string;
  wipLimit: number | null;
  order: number;
};

/**
 * Reconcile a board column's sub-columns (create/update/delete). Sub-column
 * names are unique within the column. ADMIN / owner / LEAD of the column's
 * project only. Deleting a sub-column returns its cards to column-level
 * placement via the FK (onDelete: SetNull).
 */
export async function updateBoardSubColumnsAction(
  columnId: string,
  subColumns: BoardSubColumnInput[],
): Promise<ActionResult> {
  const me = await requireAuth();
  const column = await prisma.boardColumn.findUnique({
    where: { id: columnId },
    select: {
      project: {
        select: {
          id: true,
          key: true,
          ownerId: true,
          members: { select: { userId: true, role: true } },
        },
      },
    },
  });
  if (!column) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Колонка не найдена' } };
  }
  if (
    !canEditProject(
      { id: me.id, role: me.role },
      column.project,
      await getEffectiveCapsForProject({ id: me.id, role: me.role }, column.project.id),
    )
  ) {
    return {
      ok: false,
      error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' },
    };
  }

  const existing = await prisma.boardSubColumn.findMany({
    where: { columnId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((s) => s.id));
  const seenNames = new Set<string>();
  const clean: BoardSubColumnInput[] = [];
  const keptIds = new Set<string>();
  for (const s of subColumns) {
    const name = (s.name ?? '').trim();
    if (name.length === 0 || name.length > MAX_NAME) {
      return {
        ok: false,
        error: { code: 'VALIDATION', message: `Название подколонки: 1–${MAX_NAME} символов` },
      };
    }
    const lower = name.toLowerCase();
    if (seenNames.has(lower)) {
      return { ok: false, error: { code: 'VALIDATION', message: `Дубликат подколонки «${name}»` } };
    }
    seenNames.add(lower);
    let wipLimit: number | null = null;
    if (s.wipLimit != null) {
      const n = Math.floor(Number(s.wipLimit));
      if (Number.isFinite(n) && n > 0 && n <= MAX_WIP) wipLimit = n;
    }
    const id = s.id && existingIds.has(s.id) ? s.id : null;
    if (id) keptIds.add(id);
    const order = Number.isFinite(s.order) ? Math.floor(Number(s.order)) : 0;
    clean.push({ id, name, wipLimit, order });
  }
  const toDelete = existing.filter((e) => !keptIds.has(e.id)).map((e) => e.id);

  try {
    await prisma.$transaction([
      ...clean.map((s) =>
        s.id
          ? prisma.boardSubColumn.update({
              where: { id: s.id },
              data: { name: s.name, order: s.order, wipLimit: s.wipLimit },
            })
          : prisma.boardSubColumn.create({
              data: { columnId, name: s.name, order: s.order, wipLimit: s.wipLimit },
            }),
      ),
      ...(toDelete.length > 0
        ? [prisma.boardSubColumn.deleteMany({ where: { id: { in: toDelete } } })]
        : []),
    ]);
  } catch (e) {
    console.error('updateBoardSubColumnsAction', e);
    return { ok: false, error: { code: 'INTERNAL', message: 'Не удалось сохранить подколонки' } };
  }

  revalidatePath(`/projects/${column.project.key}/board`);
  revalidatePath(`/projects/${column.project.key}/settings`);
  return { ok: true };
}

/**
 * Move a task into a sub-column (or clear with null). Called by the board after
 * the status write, so the leaf stays consistent: a non-null sub-column must
 * belong to the same project AND its parent column's status must equal the
 * task's current internalStatus. Permissioned like a board move.
 */
export async function setTaskSubColumnAction(
  taskId: string,
  subColumnId: string | null,
): Promise<ActionResult> {
  const me = await requireAuth();
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      projectId: true,
      number: true,
      internalStatus: true,
      assigneeId: true,
      creatorId: true,
      reviewerId: true,
      project: {
        select: {
          key: true,
          ownerId: true,
          members: { select: { userId: true, role: true } },
        },
      },
    },
  });
  if (!task) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Задача не найдена' } };
  }
  const isStakeholder =
    task.assigneeId === me.id || task.creatorId === me.id || task.reviewerId === me.id;
  if (
    !isStakeholder &&
    !canEditProject(
      { id: me.id, role: me.role },
      task.project,
      await getEffectiveCapsForProject({ id: me.id, role: me.role }, task.projectId),
    )
  ) {
    return {
      ok: false,
      error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' },
    };
  }
  if (subColumnId) {
    const sub = await prisma.boardSubColumn.findUnique({
      where: { id: subColumnId },
      select: { column: { select: { projectId: true, status: true } } },
    });
    if (!sub || sub.column.projectId !== task.projectId) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Подколонка не найдена' } };
    }
    // Leaf-consistency: the sub-column's parent column status must match the
    // card's current internal status (the board commits the status move first).
    if (sub.column.status !== task.internalStatus) {
      return {
        ok: false,
        error: { code: 'VALIDATION', message: 'Подколонка относится к другой колонке' },
      };
    }
  }
  try {
    await prisma.task.update({ where: { id: taskId }, data: { subColumnId } });
  } catch (e) {
    console.error('setTaskSubColumnAction', e);
    return { ok: false, error: { code: 'INTERNAL', message: 'Не удалось переместить задачу' } };
  }
  revalidatePath(`/projects/${task.project.key}/board`);
  revalidatePath(`/projects/${task.project.key}/tasks/${task.number}`);
  return { ok: true };
}
