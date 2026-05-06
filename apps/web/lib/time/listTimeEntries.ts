import { prisma } from '@giper/db';

export type ListRange =
  | { kind: 'today' | 'week' | 'month' }
  | { kind: 'custom'; from: Date; to: Date };

export function resolveRange(
  range: 'today' | 'week' | 'month' | 'custom',
  customFrom?: string,
  customTo?: string,
): { from: Date; to: Date } {
  const now = new Date();
  if (range === 'today') {
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    return { from, to };
  }
  if (range === 'week') {
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    // Monday-start week
    const day = (from.getDay() + 6) % 7;
    from.setDate(from.getDate() - day);
    const to = new Date(from);
    to.setDate(to.getDate() + 7);
    return { from, to };
  }
  if (range === 'month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
    return { from, to };
  }
  // custom
  const fromStr = customFrom ?? toIsoDate(now);
  const toStr = customTo ?? toIsoDate(now);
  return {
    from: new Date(`${fromStr}T00:00:00`),
    to: addDays(new Date(`${toStr}T00:00:00`), 1),
  };
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export async function listTimeEntries(
  userId: string,
  range: { from: Date; to: Date },
) {
  return prisma.timeEntry.findMany({
    where: {
      userId,
      startedAt: { gte: range.from, lt: range.to },
    },
    orderBy: { startedAt: 'desc' },
    select: {
      id: true,
      startedAt: true,
      endedAt: true,
      durationMin: true,
      source: true,
      note: true,
      flag: true,
      taskId: true,
      task: {
        select: {
          id: true,
          number: true,
          title: true,
          project: { select: { id: true, key: true, name: true } },
        },
      },
    },
  });
}

export type TimeEntryListItem = Awaited<ReturnType<typeof listTimeEntries>>[number];
