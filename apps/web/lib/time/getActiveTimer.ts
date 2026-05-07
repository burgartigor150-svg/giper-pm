import { prisma } from '@giper/db';
import { enforceTimerLimits, type TimerHealth } from './timeLimits';

/**
 * Returns the user's currently-running timer, if any. "Running" means a
 * MANUAL_TIMER row with endedAt = null. We only allow one such row per user.
 *
 * Side effect: enforces SOFT_WARN / HARD_STOP timer limits before reading.
 * If the active timer is past the hard limit it is closed at the boundary
 * and tagged AUTO_STOPPED — so this function will then return null.
 * Lazy enforcement is fine for our scale — every page that shows the
 * timer (every authenticated page) calls this on render.
 */
export async function getActiveTimer(userId: string) {
  await enforceTimerLimits(userId);
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

/**
 * Same as getActiveTimer but also returns the WARN/OK/AUTO_STOPPED health
 * flag so the caller (typically the layout / topbar) can render a soft-warn
 * banner without re-running the elapsed-time check on the client.
 */
export async function getActiveTimerWithHealth(
  userId: string,
): Promise<{
  timer: Awaited<ReturnType<typeof getActiveTimer>>;
  health: TimerHealth;
}> {
  const health = await enforceTimerLimits(userId);
  const timer = await prisma.timeEntry.findFirst({
    where: { userId, endedAt: null, source: 'MANUAL_TIMER' },
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
  return { timer, health };
}
