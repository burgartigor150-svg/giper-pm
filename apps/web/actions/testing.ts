'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { getEffectiveCapsForProject } from '@/lib/capabilities';
import {
  createNotification,
  fanoutToTaskAudience,
} from '@/lib/notifications/createNotifications';
import { internalStatusWrite } from '@/lib/status/refs';

type ActionResult = { ok: true } | { ok: false; error: { code: string; message: string } };

/**
 * Tester-only action: accept a task in TESTING (QA passed). Moves
 * internalStatus to REVIEW — NOT DONE: QA sign-off and review sign-off
 * stay independent and composable, so the task next goes through the
 * regular reviewer/итог gate. Posts an internal comment "✅ Тестирование
 * пройдено", notifies the assignee + audience. Anyone other than the
 * tester (or a holder of task.testing.close — ADMIN/PM by baseline) is
 * rejected. Mirrors approveTaskAction (REVIEW track) exactly.
 */
export async function acceptTestingAction(
  taskId: string,
  projectKey: string,
  taskNumber: number,
  note?: string,
): Promise<ActionResult> {
  const me = await requireAuth();
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      projectId: true,
      testerId: true,
      assigneeId: true,
      creatorId: true,
      internalStatus: true,
      title: true,
    },
  });
  if (!task) return { ok: false, error: { code: 'NOT_FOUND', message: 'Не найдена' } };
  const allowed =
    (await getEffectiveCapsForProject({ id: me.id, role: me.role }, task.projectId)).has('task.testing.close') ||
    task.testerId === me.id;
  if (!allowed) {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Только тестировщик может принять' } };
  }
  if (task.internalStatus !== 'TESTING') {
    return {
      ok: false,
      error: { code: 'STATE', message: 'Задача не в статусе TESTING' },
    };
  }
  // Move to REVIEW (not DONE) — QA passes the baton to the reviewer/итог
  // gate. No completedAt / completionResult here (those belong to DONE),
  // and no autoUnblockDependents (the task is not terminal yet).
  await prisma.task.update({
    where: { id: taskId },
    data: {
      internalStatus: 'REVIEW',
      ...(await internalStatusWrite(prisma, task.projectId, 'REVIEW')),
    },
  });
  // Internal comment so the timeline records the decision. We've already
  // validated authorization above (tester / cap holder), so we bypass
  // addComment's per-stake canViewTask check — the action's own gate is
  // the source of truth for testing decisions.
  await prisma.comment.create({
    data: {
      taskId,
      authorId: me.id,
      body: `✅ Тестирование пройдено${note?.trim() ? `: ${note.trim()}` : ''}`,
      source: 'WEB',
      visibility: 'INTERNAL',
    },
  });
  // Ping assignee + audience that QA passed and the card is on review now.
  const link = `/projects/${projectKey}/tasks/${taskNumber}`;
  if (task.assigneeId && task.assigneeId !== me.id) {
    await createNotification({
      userId: task.assigneeId,
      kind: 'TASK_STATUS_CHANGED',
      title: `Тестирование пройдено, задача на ревью`,
      body: task.title.slice(0, 200),
      link,
      payload: { taskId, projectKey, taskNumber, decision: 'acceptTesting' },
    });
  }
  await fanoutToTaskAudience(
    taskId,
    me.id,
    {
      kind: 'TASK_STATUS_CHANGED',
      title: 'Тестирование пройдено',
      link,
      payload: { taskId, decision: 'acceptTesting' },
    },
    { excludeUserIds: task.assigneeId ? [task.assigneeId] : [] },
  );
  revalidatePath(link);
  revalidatePath(`/projects/${projectKey}/board`);
  return { ok: true };
}

/**
 * Tester-only: send the task back to IN_PROGRESS with a required reason.
 * The reason is posted as an internal comment so the assignee sees what's
 * wrong. The "(тестирование)" discriminator distinguishes this loop from
 * the reviewer's return loop in the timeline. Mirrors rejectTaskAction.
 */
export async function returnFromTestingAction(
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
      error: { code: 'VALIDATION', message: 'Опишите причину возврата' },
    };
  }
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      projectId: true,
      testerId: true,
      assigneeId: true,
      creatorId: true,
      internalStatus: true,
      title: true,
    },
  });
  if (!task) return { ok: false, error: { code: 'NOT_FOUND', message: 'Не найдена' } };
  const allowed =
    (await getEffectiveCapsForProject({ id: me.id, role: me.role }, task.projectId)).has('task.testing.close') ||
    task.testerId === me.id;
  if (!allowed) {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Только тестировщик может вернуть' } };
  }
  if (task.internalStatus !== 'TESTING') {
    return {
      ok: false,
      error: { code: 'STATE', message: 'Задача не в статусе TESTING' },
    };
  }
  await prisma.task.update({
    where: { id: taskId },
    data: {
      internalStatus: 'IN_PROGRESS',
      ...(await internalStatusWrite(prisma, task.projectId, 'IN_PROGRESS')),
    },
  });
  // Same reasoning as acceptTestingAction — the action gate is the
  // authority for testing decisions; addComment's per-stake check would
  // wrongly veto ADMIN/PM (cap) fallbacks.
  await prisma.comment.create({
    data: {
      taskId,
      authorId: me.id,
      body: `↩️ Возврат на доработку (тестирование): ${text}`,
      source: 'WEB',
      visibility: 'INTERNAL',
    },
  });
  const link = `/projects/${projectKey}/tasks/${taskNumber}`;
  if (task.assigneeId && task.assigneeId !== me.id) {
    await createNotification({
      userId: task.assigneeId,
      kind: 'TASK_STATUS_CHANGED',
      title: `Задача возвращена с тестирования`,
      body: text.slice(0, 200),
      link,
      payload: { taskId, projectKey, taskNumber, decision: 'returnFromTesting' },
    });
  }
  revalidatePath(link);
  // TESTING -> IN_PROGRESS moves the card to another board column; refresh
  // the board too (acceptTestingAction already does this).
  revalidatePath(`/projects/${projectKey}/board`);
  return { ok: true };
}
