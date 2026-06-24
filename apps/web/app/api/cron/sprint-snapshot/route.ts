import { NextResponse } from 'next/server';
import { prisma } from '@giper/db';
import { isTerminal, statusCategory } from '@/lib/status/category';

/**
 * Daily sprint-snapshot writer. For every ACTIVE sprint, record the remaining
 * work (story points + task count) for today's calendar day. Powers a true
 * historical burndown line — board drags log no per-day completion, so without
 * this the chart can only show a current-state projection.
 *
 * Idempotent: upsert keyed on (sprintId, date), so re-running on the same day
 * overwrites that day's row rather than duplicating it.
 *
 * Auth: shared CRON_SECRET Bearer (same pattern as /api/cron/overdue|recurring).
 * EXTERNAL trigger required — point the same scheduler that hits the other cron
 * routes at this one (daily, e.g. just before midnight).
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function checkAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get('authorization') === `Bearer ${expected}`;
}

export async function POST(req: Request) {
  if (!checkAuth(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const now = new Date();
  // UTC midnight — the @db.Date column stores a calendar day; this is the key.
  const date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  const sprints = await prisma.sprint.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      tasks: { select: { internalStatus: true, storyPoints: true } },
    },
  });

  let written = 0;
  for (const s of sprints) {
    let totalPoints = 0;
    let remainingPoints = 0;
    let totalTasks = 0;
    let remainingTasks = 0;
    for (const t of s.tasks) {
      const pts = t.storyPoints ?? 0;
      totalTasks += 1;
      totalPoints += pts;
      if (!isTerminal(statusCategory(t.internalStatus))) {
        remainingTasks += 1;
        remainingPoints += pts;
      }
    }
    await prisma.sprintSnapshot.upsert({
      where: { sprintId_date: { sprintId: s.id, date } },
      create: { sprintId: s.id, date, remainingPoints, remainingTasks, totalPoints, totalTasks },
      update: { remainingPoints, remainingTasks, totalPoints, totalTasks, takenAt: new Date() },
    });
    written += 1;
  }

  return NextResponse.json({ ok: true, sprints: written });
}
