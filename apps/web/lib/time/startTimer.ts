import { prisma } from '@giper/db';
import { DomainError } from '../errors';
import { canViewProject, canViewTask, type SessionUser } from '../permissions';
import { stopTimer } from './stopTimer';

/**
 * Starts a live timer on a task. If the user already has a running timer
 * (on this or another task), it is stopped first — single active timer
 * per user is the invariant.
 */
export async function startTimer(taskId: string, user: SessionUser, note?: string) {
  // Validate task and project access.
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      // Task-stake fields: a user working on the task (assignee/creator/
      // reviewer/tester/co-assignee/watcher) can log time on it even without
      // project membership — mirrors the read gates (canViewTask).
      creatorId: true,
      assigneeId: true,
      reviewerId: true,
      testerId: true,
      assignments: { where: { userId: user.id }, select: { userId: true } },
      watchers: { where: { userId: user.id }, select: { userId: true } },
      project: {
        select: {
          ownerId: true,
          externalSource: true,
          members: { select: { userId: true, role: true } },
          bitrixMembers: { where: { userId: user.id }, select: { userId: true } },
        },
      },
    },
  });
  if (!task) throw new DomainError('NOT_FOUND', 404, 'Задача не найдена');
  // Allowed if the user has a stake in THIS task (canViewTask) OR access to the
  // project by membership (owner / native member / Bitrix workgroup member).
  if (!canViewTask(user, task) && !canViewProject(user, task.project)) {
    throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);
  }

  // Stop any pre-existing running timer.
  await stopTimer(user.id);

  return prisma.timeEntry.create({
    data: {
      userId: user.id,
      taskId,
      startedAt: new Date(),
      source: 'MANUAL_TIMER',
      note: note?.trim() ? note.trim() : null,
    },
    select: {
      id: true,
      startedAt: true,
      taskId: true,
    },
  });
}
