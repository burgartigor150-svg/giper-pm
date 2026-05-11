'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import {
  createNotification,
  fanoutToTaskAudience,
} from '@/lib/notifications/createNotifications';
import { autoUnblockDependents } from '@/lib/tasks/autoTransitions';

type ActionResult = { ok: true } | { ok: false; error: { code: string; message: string } };

/**
 * Reviewer-only action: approve a task in REVIEW. Moves internalStatus
 * to DONE, posts an internal comment "Одобрено …", auto-unblocks
 * dependants. Anyone other than the reviewer (or ADMIN/PM as fallback)
 * is rejected.
 */
export async function approveTaskAction(
  taskId: string,
  projectKey: string,
  taskNumber: number,
  note?: string,
): Promise<ActionResult> {
  const me = await requireAuth();
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      reviewerId: true,
      assigneeId: true,
      creatorId: true,
      internalStatus: true,
      title: true,
    },
  });
  if (!task) return { ok: false, error: { code: 'NOT_FOUND', message: 'Не найдена' } };
  const allowed =
    me.role === 'ADMIN' || me.role === 'PM' || task.reviewerId === me.id;
  if (!allowed) {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Только ревьюер может закрыть' } };
  }
  if (task.internalStatus !== 'REVIEW') {
    return {
      ok: false,
      error: { code: 'STATE', message: 'Задача не в статусе REVIEW' },
    };
  }
  await prisma.task.update({
    where: { id: taskId },
    data: { internalStatus: 'DONE', completedAt: new Date() },
  });
  // Internal comment so the timeline records the decision. We've
  // already validated authorization above (reviewer/ADMIN/PM), so we
  // bypass addComment's per-stake canViewTask check — the action's own
  // gate is the source of truth for review decisions.
  await prisma.comment.create({
    data: {
      taskId,
      authorId: me.id,
      body: `✅ Одобрено${note?.trim() ? `: ${note.trim()}` : ''}`,
      source: 'WEB',
      visibility: 'INTERNAL',
    },
  });
  // Closing the task may free up dependants.
  await autoUnblockDependents(taskId, me.id);
  // Ping assignee + creator that approval landed.
  const link = `/projects/${projectKey}/tasks/${taskNumber}`;
  if (task.assigneeId && task.assigneeId !== me.id) {
    await createNotification({
      userId: task.assigneeId,
      kind: 'TASK_STATUS_CHANGED',
      title: `Ваша задача одобрена ревьюером`,
      body: task.title.slice(0, 200),
      link,
      payload: { taskId, projectKey, taskNumber, decision: 'approve' },
    });
  }
  await fanoutToTaskAudience(
    taskId,
    me.id,
    {
      kind: 'TASK_STATUS_CHANGED',
      title: 'Задача одобрена',
      link,
      payload: { taskId, decision: 'approve' },
    },
    { excludeUserIds: task.assigneeId ? [task.assigneeId] : [] },
  );
  revalidatePath(link);
  revalidatePath(`/projects/${projectKey}/board`);
  return { ok: true };
}

/**
 * Reviewer-only: send the task back to IN_PROGRESS with a required
 * reason. The reason is posted as an internal comment so the assignee
 * sees what's wrong without us needing a dedicated rejection field.
 */
export async function rejectTaskAction(
  taskId: string,
  projectKey: string,
  taskNumber: number,
  reason: string,
): Promise<ActionResult> {
  const me = await requireAuth();
  const text = reason.trim();
  if (text.length < 3) {
    return {
      ok: false,
      error: { code: 'VALIDATION', message: 'Опишите причину отклонения' },
    };
  }
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      reviewerId: true,
      assigneeId: true,
      creatorId: true,
      internalStatus: true,
      title: true,
    },
  });
  if (!task) return { ok: false, error: { code: 'NOT_FOUND', message: 'Не найдена' } };
  const allowed =
    me.role === 'ADMIN' || me.role === 'PM' || task.reviewerId === me.id;
  if (!allowed) {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Только ревьюер может вернуть' } };
  }
  if (task.internalStatus !== 'REVIEW') {
    return {
      ok: false,
      error: { code: 'STATE', message: 'Задача не в статусе REVIEW' },
    };
  }
  await prisma.task.update({
    where: { id: taskId },
    data: { internalStatus: 'IN_PROGRESS' },
  });
  // Same reasoning as approveTaskAction — the action gate is the
  // authority for review decisions; addComment's per-stake check would
  // wrongly veto ADMIN/PM fallbacks.
  await prisma.comment.create({
    data: {
      taskId,
      authorId: me.id,
      body: `↩️ Возврат на доработку: ${text}`,
      source: 'WEB',
      visibility: 'INTERNAL',
    },
  });
  const link = `/projects/${projectKey}/tasks/${taskNumber}`;
  if (task.assigneeId && task.assigneeId !== me.id) {
    await createNotification({
      userId: task.assigneeId,
      kind: 'TASK_STATUS_CHANGED',
      title: `Задача возвращена на доработку`,
      body: text.slice(0, 200),
      link,
      payload: { taskId, projectKey, taskNumber, decision: 'reject' },
    });
  }
  revalidatePath(link);
  return { ok: true };
}
