'use server';

import { revalidatePath } from 'next/cache';
import { prisma, type TaskStatus } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { canEditProject } from '@/lib/permissions';
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
  if (!canEditProject({ id: me.id, role: me.role }, project)) {
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

  try {
    await prisma.$transaction(
      clean.map((c) =>
        prisma.boardColumn.upsert({
          where: { projectId_status: { projectId, status: c.status } },
          create: {
            projectId,
            status: c.status,
            name: c.name,
            order: c.order,
            wipLimit: c.wipLimit,
          },
          update: { name: c.name, order: c.order, wipLimit: c.wipLimit },
        }),
      ),
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
  if (!canEditProject({ id: me.id, role: me.role }, project)) {
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
  if (!canEditProject({ id: me.id, role: me.role }, task.project)) {
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
