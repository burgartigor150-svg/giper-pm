'use server';

import { revalidatePath } from 'next/cache';
import { prisma, type TaskStatus, type StatusCategory } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { canEditProject } from '@/lib/permissions';
import { getEffectiveCapsForProject } from '@/lib/capabilities';
import { categoryToTaskStatus } from '@/lib/status/category';
import { STATUS_SEED, materializeProjectColumns } from '@/lib/status/backfillStatuses';
import { setInternalStatus } from '@/lib/tasks/setInternalStatus';
import { runColumnEnterAutomations } from '@/lib/automations/runColumnEnterAutomations';
import { isColumnTransitionAllowed } from '@/lib/workflow/isColumnTransitionAllowed';
import { autoUnblockDependents } from '@/lib/tasks/autoTransitions';
import { assertWipNotExceeded } from '@/lib/board/assertWipNotExceeded';
import { DomainError } from '@/lib/errors';
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
 * Change a free-form column's TYPE (status category). Kaiten parity: the
 * column's type — not its name — drives the status of the cards in it, so
 * re-typing CASCADES every card in the column to the new category (matching
 * Kaiten, where re-typing a column to «Готово» completes its cards). The
 * column's backing Status row is re-categorized in place.
 *
 * - If this is the LAST column of the old category, stranded cards of that
 *   category with no column (columnId null — e.g. a previously-deleted column
 *   SetNull'd them) are swept into this column too, so they can't be orphaned
 *   into a category with no column (which would hide them on a free-form board).
 * - to DONE: stamps completedAt on NATIVE cards that lack one (Bitrix-mirror
 *   cards keep Bitrix as the owner of completion — stamping locally would just
 *   be cleared by the next inbound sync), and best-effort auto-unblocks the
 *   dependents of cards that actually block something. The per-card «итог»
 *   requirement is bypassed (structural admin action, not a user close) and the
 *   Bitrix mirror is NOT pushed.
 * - re-typing AWAY from DONE leaves completedAt as-is (same as the per-card path).
 * - CANCELED is rejected — a CANCELED column is hidden from the board.
 *
 * Note: a bulk re-type does NOT emit per-card TaskStatusChange/audit/webhook
 * events — it's a structural board edit, not N user-initiated status changes.
 */
export async function setBoardColumnCategoryAction(
  columnId: string,
  category: StatusCategory,
): Promise<ActionResult> {
  const me = await requireAuth();
  const gate = await editableColumnOrError(columnId);
  if (!gate.ok) return gate;
  if (!VALID_CATEGORIES.has(category)) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Неверная категория статуса' } };
  }
  if (category === 'CANCELED') {
    return { ok: false, error: { code: 'VALIDATION', message: 'Нельзя сменить тип на «Отмена»' } };
  }
  const col = gate.column;
  const oldStatus = col.status;
  const newStatus = categoryToTaskStatus(category);
  if (oldStatus === newStatus) return { ok: true }; // no-op

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Re-categorize the column's backing Status row (kept in place).
      if (col.statusId) {
        await tx.status.update({
          where: { id: col.statusId },
          data: { category, color: CATEGORY_COLOR[category] ?? null },
        });
      }
      // 2. Re-type the column itself.
      await tx.boardColumn.update({
        where: { id: columnId },
        data: { status: newStatus, color: CATEGORY_COLOR[category] ?? null },
      });
      // 3. Cascade every card in this column to the new category (dual-write the
      //    enum + the Status FK). internalStatusId stays the column's own Status.
      await tx.task.updateMany({
        where: { columnId },
        data: { internalStatus: newStatus, ...(col.statusId ? { internalStatusId: col.statusId } : {}) },
      });
      // 3b. If this was the LAST column of the old category, no column is left to
      //     bucket cards still in that category but with no column (null columnId
      //     — e.g. orphaned by a prior column delete's SetNull). Sweep them into
      //     this column so they don't vanish from a free-form board.
      const remainingOldCols = await tx.boardColumn.count({
        where: { projectId: col.projectId, status: oldStatus },
      });
      if (remainingOldCols === 0) {
        await tx.task.updateMany({
          where: { projectId: col.projectId, columnId: null, internalStatus: oldStatus },
          data: {
            internalStatus: newStatus,
            columnId,
            ...(col.statusId ? { internalStatusId: col.statusId } : {}),
          },
        });
      }
      // 4. Entering DONE stamps a completion time on NATIVE cards that lack one
      //    (mirrors setInternalStatus). Bitrix-mirror cards are skipped — Bitrix
      //    owns their completion, and a local stamp would be cleared by the next
      //    inbound sync (which overwrites completedAt from upstream).
      if (category === 'DONE') {
        await tx.task.updateMany({
          where: { columnId, externalSource: null, completedAt: null },
          data: { completedAt: new Date() },
        });
      }
    });
  } catch (e) {
    console.error('setBoardColumnCategoryAction', e);
    return { ok: false, error: { code: 'INTERNAL', message: 'Не удалось сменить тип колонки' } };
  }

  // Best-effort auto-unblock for cards that just became DONE. Bound to cards that
  // ACTUALLY block something (an outgoing BLOCKS edge) so a large column doesn't
  // fan out N no-op calls. Outside the transaction; failures never undo the
  // re-type.
  if (category === 'DONE') {
    const blockerEdges = await prisma.taskDependency.findMany({
      where: { fromTask: { columnId }, linkType: 'BLOCKS' },
      select: { fromTaskId: true },
      distinct: ['fromTaskId'],
    });
    for (const e of blockerEdges) {
      await autoUnblockDependents(e.fromTaskId, me.id).catch(() => {});
    }
  }

  revalidatePath(`/projects/${col.key}/board`);
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
      columnId: true,
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
    // WIP: entering a DIFFERENT column → enforce the EXPLICIT target column's
    // limit up-front, before any write, so a rejected move commits nothing. The
    // cross-category core call below gets skipWip so it doesn't ALSO check the
    // default column the category resolves to.
    if (task.columnId !== columnId) {
      await assertWipNotExceeded(task.projectId, { columnId, status: col.status }, taskId);
    }
    if (task.internalStatus !== col.status) {
      // Category change → the workflow-gated core enforces the transition + runs
      // side effects (it also rejects a forbidden move / a DONE without an итог).
      // Thread the destination columnId so per-column automation rules fire too.
      await setInternalStatus(taskId, col.status, me, { columnId, skipWip: true });
      await prisma.task.update({
        where: { id: taskId },
        data: { columnId, ...(col.statusId ? { internalStatusId: col.statusId } : {}) },
      });
    } else {
      // Same-category move (e.g. «Code Review» → «QA», both REVIEW). The category
      // engine doesn't see this move, so enforce the per-column transition
      // allowlist here (inert when the project has no column rules). Reject
      // BEFORE writing anything so a denied move commits nothing.
      if (!(await isColumnTransitionAllowed(task.projectId, task.columnId, columnId))) {
        return {
          ok: false,
          error: {
            code: 'TRANSITION_NOT_ALLOWED',
            message: 'Переход между колонками запрещён правилами рабочего процесса',
          },
        };
      }
      // Re-pin the column only — internalStatus / startedAt / completedAt /
      // TaskStatusChange are deliberately left untouched so reports, burndown,
      // versions and the mirror stay correct. The status core is skipped, so fire
      // the column-enter automations here (best-effort; never throws) —
      // historically this move fired nothing at all. columnRulesOnly: the card
      // entered a new COLUMN but not a new CATEGORY, so only the destination
      // column's rules run; a category-keyed rule must not re-fire on an
      // intra-category shuffle.
      await prisma.task.update({
        where: { id: taskId },
        data: { columnId, ...(col.statusId ? { internalStatusId: col.statusId } : {}) },
      });
      await runColumnEnterAutomations(taskId, col.status, columnId, { columnRulesOnly: true });
    }
  } catch (e) {
    // Preserve the DomainError code (WIP_EXCEEDED / TRANSITION_NOT_ALLOWED /
    // NOT_FOUND / …) so callers can distinguish a WIP/workflow rejection from a
    // generic failure — mirrors setInternalStatusAction.
    if (e instanceof DomainError) {
      return { ok: false, error: { code: e.code, message: e.message } };
    }
    const message = e instanceof Error ? e.message : 'Не удалось переместить задачу';
    return { ok: false, error: { code: 'INTERNAL', message } };
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
  // Free-form DnD addresses columns by their real id, so every column must be a
  // first-class BoardColumn row. Projects still on the synthesized defaults have
  // none — materialize the 6 defaults (idempotent; no-op when columns exist)
  // before flipping the flag on, so the board never shows id-less columns.
  if (enabled) {
    try {
      await materializeProjectColumns(prisma, projectId);
    } catch (e) {
      console.error('setFreeFormColumnsEnabledAction:materialize', e);
      return { ok: false, error: { code: 'INTERNAL', message: 'Не удалось подготовить колонки' } };
    }
  } else {
    // Disabling returns the board to the status-keyed (1:1) DnD path, which can't
    // address two columns that share a status — their `column-<STATUS>` droppable
    // ids would collide. Refuse until the project is back to ≤1 column per status.
    const byStatus = await prisma.boardColumn.groupBy({
      by: ['status'],
      where: { projectId },
      _count: { _all: true },
    });
    if (byStatus.some((g) => g._count._all > 1)) {
      return {
        ok: false,
        error: {
          code: 'VALIDATION',
          message: 'Сначала удалите лишние колонки — на каждый статус должно остаться не больше одной.',
        },
      };
    }
  }
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
