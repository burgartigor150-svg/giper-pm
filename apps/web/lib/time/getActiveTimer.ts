import { prisma } from '@giper/db';

/**
 * Returns the user's currently-running timer, if any. "Running" means a
 * MANUAL_TIMER row with endedAt = null. We only allow one such row per user.
 */
export async function getActiveTimer(userId: string) {
  return prisma.timeEntry.findFirst({
    where: {
      userId,
      endedAt: null,
      source: 'MANUAL_TIMER',
    },
    select: {
      id: true,
      startedAt: true,
      note: true,
      taskId: true,
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
}

export type ActiveTimer = NonNullable<Awaited<ReturnType<typeof getActiveTimer>>>;
