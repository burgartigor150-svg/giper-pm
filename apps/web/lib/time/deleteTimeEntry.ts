import { prisma } from '@giper/db';
import { DomainError } from '../errors';
import { canEditTimeEntry, type SessionUser } from '../permissions';

export async function deleteTimeEntry(entryId: string, user: SessionUser) {
  const entry = await prisma.timeEntry.findUnique({
    where: { id: entryId },
    select: { id: true, userId: true },
  });
  if (!entry) throw new DomainError('NOT_FOUND', 404);
  if (!canEditTimeEntry(user, entry)) {
    throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);
  }
  await prisma.timeEntry.delete({ where: { id: entryId } });
}
