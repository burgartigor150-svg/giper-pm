import { prisma, type TaskStatus } from '@giper/db';

const DAY = 24 * 60 * 60 * 1000;

export type BoardMetrics = {
  /** Completed tasks counted. */
  completedCount: number;
  /** Median lead time (created → completed), in hours. null if no data. */
  leadHoursMedian: number | null;
  /** Median cycle time (started → completed), in hours. null if no data. */
  cycleHoursMedian: number | null;
  /** Tasks completed per ISO week, oldest → newest (last 8 weeks). */
  throughput: { week: string; count: number }[];
  /** Current open-task count per column status (CANCELED excluded). */
  wip: { status: TaskStatus; count: number }[];
};

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Monday-anchored ISO-ish week key (YYYY-MM-DD of that week's Monday, UTC). */
function weekKey(d: Date): string {
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  const monday = new Date(d.getTime() - day * DAY);
  return monday.toISOString().slice(0, 10);
}

/**
 * Flow metrics for a project, computed from the time-tracking
 * lifecycle fields (`startedAt` / `completedAt`) — robust and cheap, no history
 * reconstruction. Lead/cycle medians + weekly throughput + current WIP.
 *
 * Note: most complete for the team's own (local) tasks, whose lifecycle
 * timestamps are set on board moves.
 */
export async function getBoardMetrics(
  projectId: string,
  now: number,
): Promise<BoardMetrics> {
  const [completed, wipGroups] = await Promise.all([
    prisma.task.findMany({
      where: { projectId, completedAt: { not: null } },
      select: { createdAt: true, startedAt: true, completedAt: true },
    }),
    prisma.task.groupBy({
      by: ['internalStatus'],
      // WIP = work currently in flight. Exclude DONE as well as CANCELED —
      // otherwise finished tasks accumulate forever and inflate the
      // "Открытых задач в работе" chart + its screen-reader summary.
      // (Completions are counted separately via throughput/completedAt.)
      where: { projectId, internalStatus: { notIn: ['CANCELED', 'DONE'] } },
      _count: { _all: true },
    }),
  ]);

  const leadHours: number[] = [];
  const cycleHours: number[] = [];
  for (const t of completed) {
    if (!t.completedAt) continue;
    const done = t.completedAt.getTime();
    leadHours.push((done - t.createdAt.getTime()) / 3_600_000);
    if (t.startedAt) {
      const c = (done - t.startedAt.getTime()) / 3_600_000;
      if (c >= 0) cycleHours.push(c);
    }
  }

  // Throughput: last 8 weeks, anchored on the current week's Monday.
  const weeks: string[] = [];
  for (let i = 7; i >= 0; i--) weeks.push(weekKey(new Date(now - i * 7 * DAY)));
  const counts = new Map<string, number>(weeks.map((w) => [w, 0]));
  for (const t of completed) {
    if (!t.completedAt) continue;
    const k = weekKey(t.completedAt);
    if (counts.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  return {
    completedCount: completed.length,
    leadHoursMedian: median(leadHours),
    cycleHoursMedian: median(cycleHours),
    throughput: weeks.map((w) => ({ week: w, count: counts.get(w) ?? 0 })),
    wip: wipGroups.map((g) => ({ status: g.internalStatus, count: g._count._all })),
  };
}
