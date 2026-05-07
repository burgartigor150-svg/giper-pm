import { prisma, type TaskStatus } from '@giper/db';
import { fanoutToTaskAudience } from '../notifications/createNotifications';

/**
 * If a task is still in BACKLOG/TODO and someone starts working on it
 * (timer started, hours logged), move it to IN_PROGRESS and stamp
 * startedAt. Idempotent — if it's already moved past TODO, no-op.
 *
 * Mirrors `internalStatus` only — the Bitrix-mirror `status` field
 * stays untouched so the next inbound sync doesn't conflict.
 */
export async function autoMoveToInProgress(
  taskId: string,
  actorId: string,
): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      internalStatus: true,
      startedAt: true,
      project: { select: { key: true } },
      number: true,
    },
  });
  if (!task) return;
  // Only kick off when the task hasn't moved past TODO yet. Anything
  // beyond — REVIEW, BLOCKED, DONE — is a user-managed state and we
  // shouldn't surprise them.
  if (task.internalStatus !== 'BACKLOG' && task.internalStatus !== 'TODO') return;

  const next: TaskStatus = 'IN_PROGRESS';
  await prisma.task.update({
    where: { id: taskId },
    data: {
      internalStatus: next,
      startedAt: task.startedAt ?? new Date(),
    },
  });

  // Lightweight audience ping so other watchers know work has started.
  // Dedupe is on by default — back-to-back time entries don't spam.
  await fanoutToTaskAudience(taskId, actorId, {
    kind: 'TASK_STATUS_CHANGED',
    title: 'Работа над задачей началась',
    link: `/projects/${task.project.key}/tasks/${task.number}`,
    payload: { taskId, internalStatus: next, auto: true },
  });
}

/**
 * When a task closes (DONE / CANCELED), look at every task it was
 * blocking (TaskDependency edges where it's the source). If a target
 * has no other open blockers, flip BLOCKED → TODO so the next person
 * down the dependency chain can pick it up. Each unblocked task pings
 * its assignee.
 */
export async function autoUnblockDependents(
  closedTaskId: string,
  actorId: string,
): Promise<void> {
  // Outgoing edges: this task blocks N others.
  const edges = await prisma.taskDependency.findMany({
    where: { fromTaskId: closedTaskId },
    select: { toTaskId: true },
  });
  if (edges.length === 0) return;

  for (const edge of edges) {
    // Are there any OTHER unfinished blockers still pointing at this
    // target? If so, leave it BLOCKED.
    const stillBlocked = await prisma.taskDependency.count({
      where: {
        toTaskId: edge.toTaskId,
        fromTaskId: { not: closedTaskId },
        fromTask: {
          internalStatus: { notIn: ['DONE', 'CANCELED'] },
        },
      },
    });
    if (stillBlocked > 0) continue;

    const target = await prisma.task.findUnique({
      where: { id: edge.toTaskId },
      select: {
        id: true,
        internalStatus: true,
        number: true,
        project: { select: { key: true } },
      },
    });
    if (!target) continue;
    // Only auto-flip if the target is currently BLOCKED — don't touch
    // tasks that are already BACKLOG/TODO/IN_PROGRESS.
    if (target.internalStatus !== 'BLOCKED') continue;

    await prisma.task.update({
      where: { id: target.id },
      data: { internalStatus: 'TODO' },
    });
    await fanoutToTaskAudience(target.id, actorId, {
      kind: 'TASK_STATUS_CHANGED',
      title: 'Зависимость выполнена — задача разблокирована',
      link: `/projects/${target.project.key}/tasks/${target.number}`,
      payload: { taskId: target.id, internalStatus: 'TODO', auto: true },
    });
  }
}
