import { prisma } from '@giper/db';
import type { LogTimeInput } from '@giper/shared';
import { DomainError } from '../errors';
import { canViewProject, canViewTask, type SessionUser } from '../permissions';
import { hasOverlappingEntry } from './findOverlap';

/**
 * Logs time manually for a past interval. If the new interval overlaps
 * with another entry of the same user, the new row is flagged
 * OVERLAPPING — but still saved. We only flag the new one, not its
 * partners; otherwise the same overlap shows up twice.
 */
export async function logTimeManually(input: LogTimeInput, user: SessionUser) {
  if (input.taskId) {
    const task = await prisma.task.findUnique({
      where: { id: input.taskId },
      select: {
        // Task-stake fields: someone working on the task can log time on it
        // even without project membership (mirrors canViewTask / the read gates).
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
    // Allowed if the user has a stake in THIS task OR project membership access.
    if (!canViewTask(user, task) && !canViewProject(user, task.project)) {
      throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);
    }
  }

  const overlap = await hasOverlappingEntry(user.id, input.startedAt, input.endedAt);

  const durationMin = Math.max(
    1,
    Math.round((input.endedAt.getTime() - input.startedAt.getTime()) / 60_000),
  );

  return prisma.timeEntry.create({
    data: {
      userId: user.id,
      taskId: input.taskId ?? null,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      durationMin,
      source: 'MANUAL_FORM',
      note: input.note ?? null,
      name: input.name ?? null,
      stage: input.stage ?? null,
      flag: overlap ? 'OVERLAPPING' : null,
    },
    select: { id: true, durationMin: true, flag: true },
  });
}
