import { prisma } from '@giper/db';

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Minimum gap to surface as "забыли списать". Smaller stretches are noise
 * (bathroom, coffee, switching tasks). Tunable via env without a deploy.
 */
const GAP_THRESHOLD_MIN = Number(process.env.GAP_DETECTOR_MIN_MINUTES ?? 30);

/**
 * Today's time entries in chronological order. Used by /me to show the
 * "what I did today" timeline. Includes the active (still-running) entry
 * if there is one — the UI renders it with a live duration ticker.
 */
export async function getTodayTimeline(userId: string) {
  const from = startOfToday();
  const to = new Date(from.getTime() + 24 * 3600_000);
  return prisma.timeEntry.findMany({
    where: {
      userId,
      startedAt: { gte: from, lt: to },
    },
    orderBy: { startedAt: 'asc' },
    select: {
      id: true,
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
          project: { select: { key: true, name: true } },
        },
      },
    },
  });
}

export type DayGap = {
  /** Start of the unaccounted stretch (= endedAt of the previous entry). */
  from: Date;
  /** End of the unaccounted stretch (= startedAt of the next entry). */
  to: Date;
  minutes: number;
};

/**
 * Detect gaps in today's logged time. A gap is any stretch of
 * GAP_THRESHOLD_MIN+ minutes between two adjacent time entries (or
 * between the day's first entry and the previous gap-anchor — but we
 * don't anchor on "9 AM" because giper-pm has no concept of working
 * hours yet, so we only surface gaps INSIDE the bracket of logged time).
 *
 * The active timer is NOT a gap — it's currently in progress.
 *
 * Used by /me to show "у вас 1ч 30м между 11:00 и 12:30 не покрыто
 * записями", with a one-click affordance to log it.
 */
export async function getTodayGaps(userId: string): Promise<DayGap[]> {
  const entries = await getTodayTimeline(userId);
  if (entries.length < 2) return [];

  const closed = entries
    .filter((e) => e.endedAt != null)
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

  const gaps: DayGap[] = [];
  for (let i = 0; i < closed.length - 1; i++) {
    const cur = closed[i]!;
    const next = closed[i + 1]!;
    if (!cur.endedAt) continue;
    const diffMin = Math.floor(
      (next.startedAt.getTime() - cur.endedAt.getTime()) / 60_000,
    );
    if (diffMin >= GAP_THRESHOLD_MIN) {
      gaps.push({
        from: cur.endedAt,
        to: next.startedAt,
        minutes: diffMin,
      });
    }
  }
  return gaps;
}

/**
 * Tasks assigned to the user, sorted by deadline, capped to the next 7
 * days plus already-overdue ones. Tasks without a due date are excluded —
 * the dashboard already lists "in progress" without due dates, this view
 * is specifically about time pressure.
 */
export async function getUpcomingDeadlines(userId: string) {
  const today = startOfToday();
  const horizon = new Date(today.getTime() + 7 * 24 * 3600_000);
  return prisma.task.findMany({
    where: {
      assigneeId: userId,
      dueDate: { lte: horizon, not: null },
      status: { notIn: ['DONE', 'CANCELED'] },
    },
    orderBy: { dueDate: 'asc' },
    take: 50,
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      priority: true,
      dueDate: true,
      project: { select: { key: true, name: true } },
    },
  });
}
