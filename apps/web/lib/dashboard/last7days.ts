import { prisma } from '@giper/db';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Returns 7 buckets: { dayKey, label, minutes } from 6 days ago through today.
 * Closed entries use durationMin; the active timer contributes
 * (now - startedAt) into today's bucket.
 */
export async function getLast7Days(userId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - 6);
  const end = new Date(today.getTime() + 24 * 3600_000);

  const entries = await prisma.timeEntry.findMany({
    where: {
      userId,
      startedAt: { gte: start, lt: end },
    },
    select: { startedAt: true, endedAt: true, durationMin: true },
  });

  const buckets: { dayKey: string; label: string; minutes: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const label = new Intl.DateTimeFormat('ru-RU', {
      weekday: 'short',
      day: '2-digit',
    }).format(d);
    buckets.push({ dayKey: dayKey(d), label, minutes: 0 });
  }
  const byKey = new Map(buckets.map((b) => [b.dayKey, b]));

  const now = Date.now();
  for (const e of entries) {
    const minutes =
      e.endedAt && e.durationMin
        ? e.durationMin
        : Math.max(0, Math.floor((now - e.startedAt.getTime()) / 60_000));
    const k = dayKey(e.startedAt);
    const b = byKey.get(k);
    if (b) b.minutes += minutes;
  }

  return buckets;
}
