'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { canEditTask } from '@/lib/permissions';

/**
 * Checklist CRUD inside a task. Permission model: anyone with edit
 * rights on the parent task can mutate checklists. Toggling individual
 * items, however, is allowed for any task viewer — common case is "QA
 * looks at the page and ticks her own checklist", and gating that
 * behind canEditTask would force every QA to be a project member with
 * write access.
 */

type ActionResult = { ok: true } | { ok: false; error: { code: string; message: string } };

async function loadTaskForEdit(taskId: string) {
  const me = await requireAuth();
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      creatorId: true,
      assigneeId: true,
      externalSource: true,
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
    return {
      task: null,
      me,
      error: { code: 'NOT_FOUND', message: 'Не найдено' } as { code: string; message: string },
    };
  }
  if (!canEditTask({ id: me.id, role: me.role }, task)) {
    return {
      task: null,
      me,
      error: {
        code: 'INSUFFICIENT_PERMISSIONS',
        message: 'Недостаточно прав',
      } as { code: string; message: string },
    };
  }
  return { task, me, error: null as { code: string; message: string } | null };
}

export async function createChecklistAction(
  taskId: string,
  projectKey: string,
  taskNumber: number,
  title?: string,
): Promise<ActionResult & { id?: string }> {
  const r = await loadTaskForEdit(taskId);
  if (r.error) return { ok: false, error: r.error };

  const max = await prisma.checklist.aggregate({
    where: { taskId },
    _max: { order: true },
  });
  const order = (max._max.order ?? -1) + 1;
  const created = await prisma.checklist.create({
    data: {
      taskId,
      title: title?.trim() || 'Чек-лист',
      order,
    },
    select: { id: true },
  });
  revalidatePath(`/projects/${projectKey}/tasks/${taskNumber}`);
  return { ok: true, id: created.id };
}

export async function renameChecklistAction(
  checklistId: string,
  projectKey: string,
  taskNumber: number,
  title: string,
): Promise<ActionResult> {
  const checklist = await prisma.checklist.findUnique({
    where: { id: checklistId },
    select: { taskId: true },
  });
  if (!checklist) return { ok: false, error: { code: 'NOT_FOUND', message: 'Не найдено' } };
  const r = await loadTaskForEdit(checklist.taskId);
  if (r.error) return { ok: false, error: r.error };

  const trimmed = title.trim().slice(0, 100);
  if (!trimmed) return { ok: false, error: { code: 'VALIDATION', message: 'Название пусто' } };
  await prisma.checklist.update({
    where: { id: checklistId },
    data: { title: trimmed },
  });
  revalidatePath(`/projects/${projectKey}/tasks/${taskNumber}`);
  return { ok: true };
}

export async function deleteChecklistAction(
  checklistId: string,
  projectKey: string,
  taskNumber: number,
): Promise<ActionResult> {
  const checklist = await prisma.checklist.findUnique({
    where: { id: checklistId },
    select: { taskId: true },
  });
  if (!checklist) return { ok: false, error: { code: 'NOT_FOUND', message: 'Не найдено' } };
  const r = await loadTaskForEdit(checklist.taskId);
  if (r.error) return { ok: false, error: r.error };

  await prisma.checklist.delete({ where: { id: checklistId } });
  revalidatePath(`/projects/${projectKey}/tasks/${taskNumber}`);
  return { ok: true };
}

export async function addChecklistItemAction(
  checklistId: string,
  projectKey: string,
  taskNumber: number,
  body: string,
): Promise<ActionResult & { id?: string }> {
  const checklist = await prisma.checklist.findUnique({
    where: { id: checklistId },
    select: { taskId: true },
  });
  if (!checklist) return { ok: false, error: { code: 'NOT_FOUND', message: 'Не найдено' } };
  const r = await loadTaskForEdit(checklist.taskId);
  if (r.error) return { ok: false, error: r.error };

  const trimmed = body.trim().slice(0, 500);
  if (!trimmed) return { ok: false, error: { code: 'VALIDATION', message: 'Пустой пункт' } };
  const max = await prisma.checklistItem.aggregate({
    where: { checklistId },
    _max: { order: true },
  });
  const order = (max._max.order ?? -1) + 1;
  const created = await prisma.checklistItem.create({
    data: { checklistId, body: trimmed, order },
    select: { id: true },
  });
  revalidatePath(`/projects/${projectKey}/tasks/${taskNumber}`);
  return { ok: true, id: created.id };
}

/**
 * Toggle an item's done flag. Looser permission than other mutations —
 * any viewer of the parent task can tick. Records `doneById`/`doneAt`
 * on transition so we know who actually checked it.
 */
export async function toggleChecklistItemAction(
  itemId: string,
  projectKey: string,
  taskNumber: number,
  isDone: boolean,
): Promise<ActionResult> {
  const me = await requireAuth();
  const item = await prisma.checklistItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      isDone: true,
      checklist: {
        select: {
          task: {
            select: {
              id: true,
              creatorId: true,
              assigneeId: true,
              externalSource: true,
              project: {
                select: {
                  ownerId: true,
                  members: { select: { userId: true, role: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!item) return { ok: false, error: { code: 'NOT_FOUND', message: 'Не найдено' } };
  // Toggling doesn't require canEdit — any viewer can tick.
  const task = item.checklist.task;
  const isMember =
    me.role === 'ADMIN' ||
    me.role === 'PM' ||
    task.creatorId === me.id ||
    task.assigneeId === me.id ||
    task.project.ownerId === me.id ||
    task.project.members.some((m) => m.userId === me.id);
  if (!isMember) {
    return {
      ok: false,
      error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Нет доступа' },
    };
  }

  await prisma.checklistItem.update({
    where: { id: itemId },
    data: {
      isDone,
      doneById: isDone ? me.id : null,
      doneAt: isDone ? new Date() : null,
    },
  });
  revalidatePath(`/projects/${projectKey}/tasks/${taskNumber}`);
  return { ok: true };
}

export async function deleteChecklistItemAction(
  itemId: string,
  projectKey: string,
  taskNumber: number,
): Promise<ActionResult> {
  const item = await prisma.checklistItem.findUnique({
    where: { id: itemId },
    select: { checklist: { select: { taskId: true } } },
  });
  if (!item) return { ok: false, error: { code: 'NOT_FOUND', message: 'Не найдено' } };
  const r = await loadTaskForEdit(item.checklist.taskId);
  if (r.error) return { ok: false, error: r.error };

  await prisma.checklistItem.delete({ where: { id: itemId } });
  revalidatePath(`/projects/${projectKey}/tasks/${taskNumber}`);
  return { ok: true };
}
