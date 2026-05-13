import { prisma } from '@giper/db';
import {
  endOfDay,
  startOfDay,
  startOfWeek,
  type ReportsRange,
} from './filters';
import type { ScopedQuery } from './scope';

/**
 * Time entries with the fields every report needs. Includes the live
 * (still-running) entry — we synthesise its duration as `now - startedAt`
 * so reports stay live without forcing the user to stop the timer first.
 */
async function fetchEntries(scope: ScopedQuery, range: ReportsRange) {
  return prisma.timeEntry.findMany({
    where: {
      startedAt: { lte: range.to, gte: range.from },
      // Pick exactly one user filter: a specific selected user, or the
      // whole visible team. Spreading both lets the second clobber the
      // first, which is how the old code accidentally widened scope.
      ...(scope.userId
        ? { userId: scope.userId }
        : { userId: { in: [...scope.visibleUserIds] } }),
      ...(scope.projectId
        ? { task: { projectId: scope.projectId } }
        : {
            task: { projectId: { in: scope.visibleProjectIds } },
          }),
    },
    select: {
      startedAt: true,
      endedAt: true,
      durationMin: true,
      userId: true,
      task: {
        select: {
          id: true,
          number: true,
          title: true,
          type: true,
          status: true,
          estimateHours: true,
          completedAt: true,
          project: { select: { key: true, name: true } },
        },
      },
    },
  });
}

function durationOf(e: {
  startedAt: Date;
  endedAt: Date | null;
  durationMin: number | null;
}): number {
  if (e.endedAt && e.durationMin != null) return e.durationMin;
  if (!e.endedAt) {
    return Math.max(0, Math.floor((Date.now() - e.startedAt.getTime()) / 60_000));
  }
  return 0;
}

// ---------- Velocity ---------------------------------------------------

/**
 * Hours-per-bucket trend for the period. Bucket = day for short periods,
 * week for the 12w view (set by `range.granularity`). Returns the full
 * series including zero buckets so the chart line is continuous.
 */
export async function getVelocity(scope: ScopedQuery, range: ReportsRange) {
  const entries = await fetchEntries(scope, range);
  const buckets = new Map<string, number>();

  // Pre-fill empty buckets so the chart doesn't gap.
  if (range.granularity === 'day') {
    let cur = startOfDay(range.from);
    while (cur <= range.to) {
      buckets.set(cur.toISOString().slice(0, 10), 0);
      cur = new Date(cur.getTime() + 24 * 3600_000);
    }
  } else {
    let cur = startOfWeek(range.from);
    while (cur <= range.to) {
      buckets.set(cur.toISOString().slice(0, 10), 0);
      cur = new Date(cur.getTime() + 7 * 24 * 3600_000);
    }
  }

  for (const e of entries) {
    const min = durationOf(e);
    if (min === 0) continue;
    const key =
      range.granularity === 'day'
        ? startOfDay(e.startedAt).toISOString().slice(0, 10)
        : startOfWeek(e.startedAt).toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) ?? 0) + min);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, minutes]) => ({ date, hours: +(minutes / 60).toFixed(2) }));
}

// ---------- Burndown ---------------------------------------------------

/**
 * Two cumulative series for the period:
 *   - estimated: sum of estimateHours of tasks created in the window.
 *   - done:      sum of estimateHours of tasks completed in the window.
 * Both rendered as a step area chart — gap = remaining work.
 */
export async function getBurndown(scope: ScopedQuery, range: ReportsRange) {
  const tasks = await prisma.task.findMany({
    where: {
      OR: [
        { createdAt: { gte: range.from, lte: range.to } },
        { completedAt: { gte: range.from, lte: range.to } },
      ],
      ...(scope.projectId
        ? { projectId: scope.projectId }
        : { projectId: { in: scope.visibleProjectIds } }),
      ...(scope.userId
        ? { assigneeId: scope.userId }
        : { assigneeId: { in: [...scope.visibleUserIds] } }),
    },
    select: {
      createdAt: true,
      completedAt: true,
      estimateHours: true,
    },
  });

  // Pre-fill day buckets.
  const buckets = new Map<
    string,
    { estimated: number; done: number }
  >();
  let cur = startOfDay(range.from);
  while (cur <= range.to) {
    buckets.set(cur.toISOString().slice(0, 10), { estimated: 0, done: 0 });
    cur = new Date(cur.getTime() + 24 * 3600_000);
  }

  for (const t of tasks) {
    const hours = t.estimateHours ? Number(t.estimateHours) : 0;
    if (hours === 0) continue;
    const ck = startOfDay(t.createdAt).toISOString().slice(0, 10);
    const cb = buckets.get(ck);
    if (cb) cb.estimated += hours;
    if (t.completedAt) {
      const dk = startOfDay(t.completedAt).toISOString().slice(0, 10);
      const db = buckets.get(dk);
      if (db) db.done += hours;
    }
  }

  // Cumulative.
  let est = 0;
  let done = 0;
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => {
      est += v.estimated;
      done += v.done;
      return {
        date,
        estimated: +est.toFixed(1),
        done: +done.toFixed(1),
      };
    });
}

// ---------- Heatmap ----------------------------------------------------

/**
 * 7×24 matrix: rows = day of week (Mon..Sun), cols = hour of day.
 * Values = total minutes. Used to spot night work and weekend pulls.
 *
 * For long entries that cross hour boundaries we attribute the full
 * duration to the start hour — granular splitting would be more
 * accurate but for pattern detection it doesn't change the picture.
 */
export async function getHeatmap(scope: ScopedQuery, range: ReportsRange) {
  const entries = await fetchEntries(scope, range);
  // 7 rows × 24 cols.
  const grid: number[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => 0),
  );
  for (const e of entries) {
    const min = durationOf(e);
    if (min === 0) continue;
    const day = (e.startedAt.getDay() + 6) % 7; // Mon=0..Sun=6
    const hour = e.startedAt.getHours();
    grid[day]![hour]! += min;
  }
  let max = 0;
  for (const row of grid) for (const v of row) if (v > max) max = v;
  return { grid, max };
}

// ---------- Top overrun ------------------------------------------------

/**
 * Tasks where actual > estimate by the largest absolute or relative
 * margin. Filters out tasks with no estimate (nothing to compare),
 * and CANCELED tasks (overrun is meaningless there). Capped at 20.
 */
export async function getTopOverrun(scope: ScopedQuery, range: ReportsRange) {
  const entries = await fetchEntries(scope, range);

  // Aggregate spent minutes per task in the visible window.
  const spent = new Map<string, number>();
  const taskMeta = new Map<
    string,
    {
      id: string;
      number: number;
      title: string;
      estimateHours: number;
      project: { key: string; name: string };
    }
  >();

  for (const e of entries) {
    if (!e.task) continue;
    if (e.task.status === 'CANCELED') continue;
    const est = e.task.estimateHours ? Number(e.task.estimateHours) : 0;
    if (est <= 0) continue;
    spent.set(e.task.id, (spent.get(e.task.id) ?? 0) + durationOf(e));
    if (!taskMeta.has(e.task.id)) {
      taskMeta.set(e.task.id, {
        id: e.task.id,
        number: e.task.number,
        title: e.task.title,
        estimateHours: est,
        project: e.task.project,
      });
    }
  }

  return Array.from(taskMeta.values())
    .map((t) => {
      const spentMin = spent.get(t.id) ?? 0;
      const spentH = spentMin / 60;
      const overrunH = spentH - t.estimateHours;
      const overrunPct = t.estimateHours > 0 ? overrunH / t.estimateHours : 0;
      return {
        ...t,
        spentHours: +spentH.toFixed(1),
        overrunHours: +overrunH.toFixed(1),
        overrunPct: +(overrunPct * 100).toFixed(0),
      };
    })
    .filter((t) => t.overrunHours > 0)
    .sort((a, b) => b.overrunHours - a.overrunHours)
    .slice(0, 20);
}

// ---------- Type distribution -----------------------------------------

const TYPES = ['TASK', 'BUG', 'FEATURE', 'EPIC', 'CHORE'] as const;

/**
 * Total minutes per task.type — pie chart input. EPIC contributes only
 * via direct entries; subtask entries roll up under their own type.
 */
export async function getTypeDistribution(
  scope: ScopedQuery,
  range: ReportsRange,
) {
  const entries = await fetchEntries(scope, range);
  const counts: Record<(typeof TYPES)[number], number> = {
    TASK: 0,
    BUG: 0,
    FEATURE: 0,
    EPIC: 0,
    CHORE: 0,
  };
  for (const e of entries) {
    if (!e.task) continue;
    counts[e.task.type] += durationOf(e);
  }
  const total = Object.values(counts).reduce((s, v) => s + v, 0);
  return TYPES.map((type) => ({
    type,
    minutes: counts[type],
    pct: total > 0 ? +((counts[type] / total) * 100).toFixed(1) : 0,
  })).filter((s) => s.minutes > 0);
}

// ---------- Time-by-task ---------------------------------------------

/**
 * Hours per task across the period — answers "куда уходит время".
 * Joined with task title / project key / status / estimate so the UI
 * can link straight to the task and compare against the original
 * estimate. Returns up to `limit` rows sorted by total hours desc.
 *
 * Entries without a task (Manual log "Без задачи") are aggregated
 * separately into `untrackedHours` — the table shouldn't hide them
 * but we don't want them mixed into the per-task ranking.
 */
export async function getTimeByTask(
  scope: ScopedQuery,
  range: ReportsRange,
  limit = 50,
) {
  const entries = await fetchEntries(scope, range);
  type Bucket = {
    id: string;
    number: number;
    title: string;
    status: string;
    estimateHours: number | null;
    project: { key: string; name: string };
    minutes: number;
    contributors: Set<string>;
  };
  const byTask = new Map<string, Bucket>();
  let untracked = 0;
  for (const e of entries) {
    const min = durationOf(e);
    if (min === 0) continue;
    if (!e.task) {
      untracked += min;
      continue;
    }
    let bucket = byTask.get(e.task.id);
    if (!bucket) {
      bucket = {
        id: e.task.id,
        number: e.task.number,
        title: e.task.title,
        status: e.task.status,
        estimateHours: e.task.estimateHours
          ? Number(e.task.estimateHours)
          : null,
        project: e.task.project,
        minutes: 0,
        contributors: new Set(),
      };
      byTask.set(e.task.id, bucket);
    }
    bucket.minutes += min;
    bucket.contributors.add(e.userId);
  }
  const rows = Array.from(byTask.values())
    .map((b) => ({
      id: b.id,
      number: b.number,
      title: b.title,
      status: b.status,
      estimateHours: b.estimateHours,
      project: b.project,
      hours: +(b.minutes / 60).toFixed(2),
      contributorCount: b.contributors.size,
    }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, limit);
  return {
    rows,
    untrackedHours: +(untracked / 60).toFixed(2),
  };
}

// ---------- Hero numbers ----------------------------------------------

/** Aggregate stat row at the top of the page. */
export async function getReportsTotals(
  scope: ScopedQuery,
  range: ReportsRange,
) {
  const entries = await fetchEntries(scope, range);
  let totalMin = 0;
  const userSet = new Set<string>();
  const taskSet = new Set<string>();
  for (const e of entries) {
    totalMin += durationOf(e);
    userSet.add(e.userId);
    if (e.task) taskSet.add(e.task.id);
  }
  return {
    totalHours: +(totalMin / 60).toFixed(1),
    activeUsers: userSet.size,
    workedTasks: taskSet.size,
  };
}

export { startOfDay, endOfDay };
