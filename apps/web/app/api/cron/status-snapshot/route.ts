import { NextResponse } from 'next/server';
import { prisma } from '@giper/db';

/**
 * Daily status-snapshot writer. Records how many cards sit in each internal
 * status, per project, for today's calendar day — the data behind the
 * cumulative-flow diagram (CFD). The board logs no per-day history, so without
 * this the CFD has nothing to plot.
 *
 * Idempotent: clears today's rows and re-inserts, so a re-run on the same day
 * overwrites rather than duplicating. One aggregate query feeds it.
 *
 * Auth: shared CRON_SECRET Bearer (same as /api/cron/overdue|recurring|
 * sprint-snapshot). EXTERNAL trigger required — point the same scheduler that
 * hits the other cron routes at this one (daily, e.g. just before midnight).
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
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  // One aggregate: card count per project per internal status. CANCELED is
  // excluded — cancelled cards leave the flow and the CFD doesn't plot them.
  const rows = await prisma.task.groupBy({
    by: ['projectId', 'internalStatus'],
    where: { internalStatus: { not: 'CANCELED' } },
    _count: { _all: true },
  });

  // Idempotent rewrite of today's snapshot, ATOMIC so a crash can't leave today
  // empty and a double-fire can't hit the unique constraint (skipDuplicates).
  await prisma.$transaction([
    prisma.statusSnapshot.deleteMany({ where: { date } }),
    ...(rows.length > 0
      ? [
          prisma.statusSnapshot.createMany({
            data: rows.map((r) => ({
              projectId: r.projectId,
              date,
              status: r.internalStatus,
              count: r._count._all,
            })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);

  return NextResponse.json({ ok: true, written: rows.length });
}
