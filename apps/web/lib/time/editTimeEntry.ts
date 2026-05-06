import { prisma } from '@giper/db';
import type { EditTimeEntryInput } from '@giper/shared';
import { DomainError } from '../errors';
import { canEditTimeEntry, canViewProject, type SessionUser } from '../permissions';
import { hasOverlappingEntry } from './findOverlap';

export async function editTimeEntry(
  entryId: string,
  input: EditTimeEntryInput,
  user: SessionUser,
) {
  const entry = await prisma.timeEntry.findUnique({
    where: { id: entryId },
    select: { id: true, userId: true, source: true, endedAt: true },
  });
  if (!entry) throw new DomainError('NOT_FOUND', 404);
  if (!canEditTimeEntry(user, entry)) {
    throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);
  }
  if (!entry.endedAt) {
    throw new DomainError('VALIDATION', 400, 'Нельзя редактировать активный таймер. Сначала остановите.');
  }

  // If task is being changed, verify access to its project.
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

  const overlap = await hasOverlappingEntry(
    entry.userId,
    input.startedAt,
    input.endedAt,
    entry.id,
  );

  const durationMin = Math.max(
    1,
    Math.round((input.endedAt.getTime() - input.startedAt.getTime()) / 60_000),
  );

  return prisma.timeEntry.update({
    where: { id: entryId },
    data: {
      taskId: input.taskId ?? null,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      durationMin,
      note: input.note ?? null,
      flag: overlap ? 'OVERLAPPING' : null,
    },
    select: { id: true, durationMin: true, flag: true },
  });
}
