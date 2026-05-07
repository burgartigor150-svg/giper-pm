import { z } from 'zod';

/**
 * Common URL-driven filter shape used by every /reports section. Keeps
 * server components decoupled (no shared client state needed) and makes
 * every report linkable / shareable.
 *
 * Periods:
 *   7d / 30d   — rolling window ending now.
 *   12w        — last 12 weeks ending now (used by velocity).
 *   custom     — explicit from/to dates (YYYY-MM-DD).
 */
export const reportsFilterSchema = z.object({
  period: z.enum(['7d', '30d', '12w', 'custom']).default('30d'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Project key (e.g. 'KSRIA'). Empty = all projects the viewer can see. */
  projectKey: z.string().optional(),
  /** Specific user. Empty = all visible users (PM/ADMIN) or just self. */
  userId: z.string().optional(),
});

export type ReportsFilter = z.infer<typeof reportsFilterSchema>;

export type ReportsRange = {
  from: Date;
  to: Date;
  /** Granularity hint for buckets — day or week. */
  granularity: 'day' | 'week';
};

export function resolveRange(filter: ReportsFilter): ReportsRange {
  const to = endOfDay(new Date());
  if (filter.period === 'custom' && filter.from && filter.to) {
    return {
      from: startOfDay(new Date(filter.from)),
      to: endOfDay(new Date(filter.to)),
      granularity: 'day',
    };
  }
  if (filter.period === '7d') {
    const from = startOfDay(new Date(to.getTime() - 7 * 24 * 3600_000));
    return { from, to, granularity: 'day' };
  }
  if (filter.period === '12w') {
    const from = startOfDay(new Date(to.getTime() - 12 * 7 * 24 * 3600_000));
    return { from, to, granularity: 'week' };
  }
  // default 30d
  const from = startOfDay(new Date(to.getTime() - 30 * 24 * 3600_000));
  return { from, to, granularity: 'day' };
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Truncate to start of ISO week (Monday). */
export function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay();
  // Sunday=0, Monday=1; we want Monday as week start.
  const offset = (day + 6) % 7;
  x.setDate(x.getDate() - offset);
  return x;
}
