import { prisma } from '@giper/db';

/**
 * Returns true if there is any time entry for `userId` whose interval
 * intersects [startedAt, endedAt). Open-ended timers (endedAt is null)
 * count as ongoing and overlap if their startedAt is before our endedAt.
 */
export async function hasOverlappingEntry(
  userId: string,
  startedAt: Date,
  endedAt: Date,
  excludeEntryId?: string,
): Promise<boolean> {
  const candidate = await prisma.timeEntry.findFirst({
    where: {
      userId,
      ...(excludeEntryId ? { id: { not: excludeEntryId } } : {}),
      startedAt: { lt: endedAt },
      OR: [
        { endedAt: null },
        { endedAt: { gt: startedAt } },
      ],
    },
    select: { id: true },
  });
  return !!candidate;
}
