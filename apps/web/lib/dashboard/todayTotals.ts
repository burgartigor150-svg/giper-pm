import { prisma } from '@giper/db';

function startOfTodayUTC(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Total minutes the user has logged today, plus per-project breakdown.
 * Active timer counts live: (now - startedAt). Closed entries use durationMin.
 */
export async function getTodayTotals(userId: string) {
  const from = startOfTodayUTC();
  const to = new Date(from.getTime() + 24 * 3600_000);

  const entries = await prisma.timeEntry.findMany({
    where: {
      userId,
      startedAt: { gte: from, lt: to },
    },
    select: {
      startedAt: true,
      endedAt: true,
      durationMin: true,
      task: {
        select: { project: { select: { id: true, key: true, name: true } } },
      },
    },
  });

  const now = Date.now();
  let totalMin = 0;
  const perProject = new Map<
    string,
    { id: string; key: string; name: string; minutes: number }
  >();
  const NONE_KEY = '__none';

  for (const e of entries) {
    const minutes =
      e.endedAt && e.durationMin
        ? e.durationMin
        : Math.max(0, Math.floor((now - e.startedAt.getTime()) / 60_000));
    totalMin += minutes;

    const key = e.task?.project.key ?? NONE_KEY;
    const cur = perProject.get(key) ?? {
      id: e.task?.project.id ?? NONE_KEY,
      key,
      name: e.task?.project.name ?? 'Без проекта',
      minutes: 0,
    };
    cur.minutes += minutes;
    perProject.set(key, cur);
  }

  return {
    totalMin,
    perProject: Array.from(perProject.values()).sort((a, b) => b.minutes - a.minutes),
  };
}
