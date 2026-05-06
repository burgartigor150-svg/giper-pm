import { prisma } from '@giper/db';
import type { LogTimeInput } from '@giper/shared';
import { DomainError } from '../errors';
import { canViewProject, type SessionUser } from '../permissions';
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
        project: {
          select: {
            ownerId: true,
            members: { select: { userId: true, role: true } },
          },
        },
      },
    });
    if (!task) throw new DomainError('NOT_FOUND', 404, 'Задача не найдена');
    if (!canViewProject(user, task.project)) {
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
      flag: overlap ? 'OVERLAPPING' : null,
    },
    select: { id: true, durationMin: true, flag: true },
  });
}
