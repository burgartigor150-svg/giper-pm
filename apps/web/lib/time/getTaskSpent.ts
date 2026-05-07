import { prisma } from '@giper/db';

/**
 * Total minutes booked against a task. Includes:
 *   - all closed time entries (durationMin),
 *   - the live time entry (now - startedAt) if one is currently running.
 *
 * Live counting is intentional — the user wants to see "what's the actual
 * cost so far?" without having to stop the timer first. Number is a
 * snapshot at request time; the page revalidates often enough that live
 * drift is invisible.
 */
export async function getTaskSpentMinutes(taskId: string): Promise<number> {
  const entries = await prisma.timeEntry.findMany({
    where: { taskId },
    select: { startedAt: true, endedAt: true, durationMin: true },
  });
  const now = Date.now();
  let total = 0;
  for (const e of entries) {
    if (e.endedAt && e.durationMin != null) {
      total += e.durationMin;
    } else if (!e.endedAt) {
      total += Math.max(0, Math.floor((now - e.startedAt.getTime()) / 60_000));
    }
  }
  return total;
}

/**
 * Same shape, batched: useful for list/board pages that need spent for
 * many tasks at once. Single query + aggregate in memory beats N round
 * trips from the page render path.
 */
export async function getTasksSpentMinutes(
  taskIds: string[],
): Promise<Map<string, number>> {
  if (taskIds.length === 0) return new Map();
  const entries = await prisma.timeEntry.findMany({
    where: { taskId: { in: taskIds } },
    select: { taskId: true, startedAt: true, endedAt: true, durationMin: true },
  });
  const now = Date.now();
  const out = new Map<string, number>();
  for (const e of entries) {
    if (!e.taskId) continue;
    const minutes =
      e.endedAt && e.durationMin != null
        ? e.durationMin
        : !e.endedAt
          ? Math.max(0, Math.floor((now - e.startedAt.getTime()) / 60_000))
          : 0;
    out.set(e.taskId, (out.get(e.taskId) ?? 0) + minutes);
  }
  return out;
}
