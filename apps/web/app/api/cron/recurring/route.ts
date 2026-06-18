import { NextResponse } from 'next/server';
import { prisma } from '@giper/db';
import { createTask } from '@/lib/tasks/createTask';
import type { SessionUser } from '@/lib/permissions';

/**
 * Recurring-card scanner. Finds active RecurringTask rows whose nextRunAt has
 * passed, creates one card per row, then advances nextRunAt past `now` (so a
 * row that fell far behind doesn't spawn a backlog of cards — it jumps forward
 * one interval at a time until it's in the future).
 *
 * Idempotent: because nextRunAt is advanced beyond `now` in the same run, a
 * second invocation in the same window creates nothing.
 *
 * Auth: shared CRON_SECRET in the Authorization header. Same pattern as
 * /api/cron/overdue. The actor for each created card is the project owner
 * (recurring cards are a project-level automation, not a user action).
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function checkAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get('authorization') === `Bearer ${expected}`;
}

const BATCH = 200; // safety cap; remaining due rows are picked up next run.
const MAX_ADVANCE_STEPS = 3650; // ~10y of daily cadence — guards against runaway loops.

export async function POST(req: Request) {
  if (!checkAuth(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const now = new Date();

  const due = await prisma.recurringTask.findMany({
    where: { active: true, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: 'asc' },
    take: BATCH,
    select: {
      id: true,
      title: true,
      description: true,
      type: true,
      priority: true,
      assigneeId: true,
      intervalDays: true,
      nextRunAt: true,
      project: { select: { key: true, ownerId: true } },
    },
  });

  // Resolve each project owner's role once (the system actor for creation).
  const ownerIds = [...new Set(due.map((d) => d.project.ownerId))];
  const owners = ownerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true, role: true },
      })
    : [];
  const actorByOwnerId = new Map<string, SessionUser>(
    owners.map((o) => [o.id, { id: o.id, role: o.role }]),
  );

  let created = 0;
  let skipped = 0;
  for (const r of due) {
    const actor = actorByOwnerId.get(r.project.ownerId);
    if (!actor) {
      skipped++;
      continue;
    }
    const interval = Math.max(1, r.intervalDays);
    // Advance nextRunAt one interval at a time until it is strictly in the
    // future — collapses any backlog into a single new card.
    let next = new Date(r.nextRunAt.getTime());
    for (let i = 0; i < MAX_ADVANCE_STEPS && next.getTime() <= now.getTime(); i++) {
      next = new Date(next.getTime() + interval * 24 * 3600_000);
    }

    try {
      await createTask(
        {
          projectKey: r.project.key,
          title: r.title,
          description: r.description || undefined,
          type: r.type,
          priority: r.priority,
          assigneeId: r.assigneeId ?? undefined,
        },
        actor,
      );
      await prisma.recurringTask.update({
        where: { id: r.id },
        data: { lastRunAt: now, nextRunAt: next },
      });
      created++;
    } catch (e) {
      // Don't let one bad row (e.g. deleted assignee) kill the batch; advance
      // its schedule anyway so it doesn't get retried every minute forever.
      console.error('cron/recurring: failed to materialize', r.id, e);
      await prisma.recurringTask
        .update({ where: { id: r.id }, data: { nextRunAt: next } })
        .catch(() => {});
      skipped++;
    }
  }

  return NextResponse.json({ ok: true, due: due.length, created, skipped });
}
