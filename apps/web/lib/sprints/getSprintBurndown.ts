import { prisma } from '@giper/db';
import { isTerminal, statusCategory } from '../status/category';

export type SprintBurndown = {
  /** True = the numbers are story points; false = task counts (no points set). */
  usePoints: boolean;
  /** Total committed (points or task count). */
  committed: number;
  /** Remaining = committed minus burned (internalStatus DONE/CANCELED). */
  remaining: number;
  /** Done/canceled count (for the % label). */
  doneCount: number;
  totalCount: number;
  startDate: string | null;
  endDate: string | null;
  /** Real per-day remaining, from SprintSnapshot (daily cron). Empty until
   *  snapshots accumulate — the chart falls back to the projection then. */
  history: { date: string; remaining: number }[];
};

/**
 * Sprint progress for the burndown chart. Burned = tasks whose INTERNAL status
 * is DONE/CANCELED (the team board track) — NOT `completedAt`, which board
 * drags never set. Uses story points when any are set, else task counts.
 *
 * Honest limitation (surfaced in the chart caption): this is a CURRENT-STATE
 * projection, not a reconstructed per-day history — `setInternalStatusAction`
 * logs no daily completion record, so a true historical burn line isn't
 * available without a snapshot job (a deliberate follow-up).
 */
export async function getSprintBurndown(sprintId: string): Promise<SprintBurndown | null> {
  try {
    const sprint = await prisma.sprint.findUnique({
      where: { id: sprintId },
      select: { startDate: true, endDate: true },
    });
    if (!sprint) return null;

    const tasks = await prisma.task.findMany({
      where: { sprintId },
      select: { internalStatus: true, storyPoints: true },
    });

    const totalCount = tasks.length;
    const doneCount = tasks.filter((t) => isTerminal(statusCategory(t.internalStatus))).length;
    const pointsSum = tasks.reduce((s, t) => s + (t.storyPoints ?? 0), 0);
    const usePoints = pointsSum > 0;

    let committed: number;
    let remaining: number;
    if (usePoints) {
      committed = pointsSum;
      remaining = tasks
        .filter((t) => !isTerminal(statusCategory(t.internalStatus)))
        .reduce((s, t) => s + (t.storyPoints ?? 0), 0);
    } else {
      committed = totalCount;
      remaining = totalCount - doneCount;
    }

    const snaps = await prisma.sprintSnapshot.findMany({
      where: { sprintId },
      orderBy: { date: 'asc' },
      select: { date: true, remainingPoints: true, remainingTasks: true },
    });
    const history = snaps.map((s) => ({
      date: s.date.toISOString().slice(0, 10),
      remaining: usePoints ? s.remainingPoints : s.remainingTasks,
    }));

    return {
      usePoints,
      committed,
      remaining,
      doneCount,
      totalCount,
      startDate: sprint.startDate ? sprint.startDate.toISOString().slice(0, 10) : null,
      endDate: sprint.endDate ? sprint.endDate.toISOString().slice(0, 10) : null,
      history,
    };
  } catch (e) {
    console.warn('getSprintBurndown: unavailable', e);
    return null;
  }
}
