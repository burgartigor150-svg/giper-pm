import { prisma } from '@giper/db';

const DONE_LIKE = ['DONE', 'CANCELED'] as const;

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
    const doneCount = tasks.filter((t) => DONE_LIKE.includes(t.internalStatus as 'DONE')).length;
    const pointsSum = tasks.reduce((s, t) => s + (t.storyPoints ?? 0), 0);
    const usePoints = pointsSum > 0;

    let committed: number;
    let remaining: number;
    if (usePoints) {
      committed = pointsSum;
      remaining = tasks
        .filter((t) => !DONE_LIKE.includes(t.internalStatus as 'DONE'))
        .reduce((s, t) => s + (t.storyPoints ?? 0), 0);
    } else {
      committed = totalCount;
      remaining = totalCount - doneCount;
    }

    return {
      usePoints,
      committed,
      remaining,
      doneCount,
      totalCount,
      startDate: sprint.startDate ? sprint.startDate.toISOString().slice(0, 10) : null,
      endDate: sprint.endDate ? sprint.endDate.toISOString().slice(0, 10) : null,
    };
  } catch (e) {
    console.warn('getSprintBurndown: unavailable', e);
    return null;
  }
}
