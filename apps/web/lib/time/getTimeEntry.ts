import { prisma } from '@giper/db';
import { DomainError } from '../errors';
import { canEditTimeEntry, type SessionUser } from '../permissions';

export async function getTimeEntry(entryId: string, user: SessionUser) {
  const entry = await prisma.timeEntry.findUnique({
    where: { id: entryId },
    select: {
      id: true,
      userId: true,
      taskId: true,
      startedAt: true,
      endedAt: true,
      durationMin: true,
      source: true,
      note: true,
      flag: true,
      task: {
        select: {
          id: true,
          number: true,
          title: true,
          project: { select: { key: true } },
        },
      },
    },
  });
  if (!entry) throw new DomainError('NOT_FOUND', 404);
  if (!canEditTimeEntry(user, entry)) {
    throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);
  }
  return entry;
}

export type TimeEntryDetail = Awaited<ReturnType<typeof getTimeEntry>>;
