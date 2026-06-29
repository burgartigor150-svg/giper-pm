import { prisma, type TaskStatus } from '@giper/db';

/**
 * Cumulative-flow diagram series for a project. Reads the daily StatusSnapshot
 * rows (written by /api/cron/status-snapshot) for the last `days` and shapes
 * them into stacked bands. CANCELED is excluded — cancelled cards leave the
 * flow. Band order is bottom→top (DONE at the bottom, inflow/BACKLOG on top).
 */

const FLOW_STATUSES: { status: TaskStatus; label: string; color: string }[] = [
  { status: 'DONE', label: 'Готово', color: '#22c55e' },
  { status: 'BLOCKED', label: 'Заблок.', color: '#ef4444' },
  { status: 'REVIEW', label: 'Ревью', color: '#f59e0b' },
  { status: 'IN_PROGRESS', label: 'В работе', color: '#3b82f6' },
  { status: 'TODO', label: 'К работе', color: '#38bdf8' },
  { status: 'BACKLOG', label: 'Бэклог', color: '#94a3b8' },
];

export type CumulativeFlow = {
  dates: string[]; // YYYY-MM-DD, ascending
  series: { status: string; label: string; color: string; counts: number[] }[];
};

export async function getCumulativeFlow(projectId: string, days = 30): Promise<CumulativeFlow> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (days - 1));

  let rows: { date: Date; status: TaskStatus; count: number }[] = [];
  try {
    rows = await prisma.statusSnapshot.findMany({
      where: {
        projectId,
        date: { gte: since },
        status: { in: FLOW_STATUSES.map((f) => f.status) }, // only the plotted bands
      },
      orderBy: { date: 'asc' },
      select: { date: true, status: true, count: true },
    });
  } catch {
    return { dates: [], series: [] }; // table not there yet during deploy→migrate
  }

  const dates: string[] = [];
  const seen = new Set<string>();
  const byKey = new Map<string, number>();
  for (const r of rows) {
    const day = r.date.toISOString().slice(0, 10);
    if (!seen.has(day)) {
      seen.add(day);
      dates.push(day);
    }
    byKey.set(`${day}|${r.status}`, r.count);
  }

  const series = FLOW_STATUSES.map((f) => ({
    status: f.status,
    label: f.label,
    color: f.color,
    counts: dates.map((d) => byKey.get(`${d}|${f.status}`) ?? 0),
  }));

  return { dates, series };
}
