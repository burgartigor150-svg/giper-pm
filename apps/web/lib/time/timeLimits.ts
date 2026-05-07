import { prisma } from '@giper/db';

/**
 * Two thresholds for the live-timer guardrail:
 *
 *   SOFT — at this duration we just nudge the user via UI ("таймер идёт
 *          4 ч, всё ок?"). Nothing is closed yet.
 *   HARD — at this duration the timer is auto-stopped and the entry is
 *          flagged AUTO_STOPPED so the day timeline can show a "проверь
 *          мне это" badge and the user can decide later (keep / trim /
 *          delete).
 *
 * Defaults are sensible for an 8-hour workday with breaks. Both are
 * overridable via env so different teams can tune without a deploy.
 */
const SOFT_HOURS = Number(process.env.TIMER_SOFT_WARN_HOURS ?? 4);
const HARD_HOURS = Number(process.env.TIMER_AUTO_STOP_HOURS ?? 6);

export const SOFT_WARN_MS = SOFT_HOURS * 3600_000;
export const HARD_STOP_MS = HARD_HOURS * 3600_000;

export type TimerHealth = 'OK' | 'WARN' | 'AUTO_STOPPED';

/**
 * Look at the user's currently-running timer (if any) and act on the
 * thresholds. Lazy: this is called from `getActiveTimer`, so any user
 * navigation drives the check — no background workers needed.
 *
 * Returns the resulting health state so callers (UI) can show a banner
 * for WARN even though the entry is still open.
 */
export async function enforceTimerLimits(userId: string): Promise<TimerHealth> {
  const active = await prisma.timeEntry.findFirst({
    where: { userId, endedAt: null, source: 'MANUAL_TIMER' },
    select: { id: true, startedAt: true },
    orderBy: { startedAt: 'desc' },
  });
  if (!active) return 'OK';

  const elapsed = Date.now() - active.startedAt.getTime();
  if (elapsed < SOFT_WARN_MS) return 'OK';
  if (elapsed < HARD_STOP_MS) return 'WARN';

  // Past the hard limit — close the entry at the hard boundary so the
  // user doesn't end up with a 21-hour booking when they forgot
  // overnight. We pin the close time to startedAt + HARD so the math is
  // exact and the entry shows "ровно 6 ч" rather than "5 ч 58 мин".
  const closedAt = new Date(active.startedAt.getTime() + HARD_STOP_MS);
  const durationMin = Math.floor(HARD_STOP_MS / 60_000);
  await prisma.timeEntry.update({
    where: { id: active.id },
    data: {
      endedAt: closedAt,
      durationMin,
      flag: 'AUTO_STOPPED',
    },
  });
  return 'AUTO_STOPPED';
}
