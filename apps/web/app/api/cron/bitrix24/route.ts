import { NextResponse } from 'next/server';
import { runBitrix24SyncNow, syncBitrixCalendarNow } from '@/lib/integrations/bitrix24';

/**
 * Cron-callable endpoint for the read-only Bitrix24 mirror. Wired to a
 * 5-minute schedule in production. Auth: a shared secret in the
 * `Authorization: Bearer <secret>` header — cheap and good enough for an
 * internal admin tool.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // up to 5 min on the first run

function checkAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false; // refuse if not configured
  const got = req.headers.get('authorization');
  return got === `Bearer ${expected}`;
}

export async function POST(req: Request) {
  if (!checkAuth(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    // ?force=1 (or =true) bypasses the since-watermark for one run —
    // useful right after a sync code change when you want every
    // mirrored task to flow through upsertOne again. Default is the
    // incremental behaviour driven by lastSuccessfulSyncStart.
    const url = new URL(req.url);
    const forceParam = url.searchParams.get('force');
    const force = forceParam === '1' || forceParam === 'true';
    // ?backfill=1 runs a one-off task-only global pull (every active task in
    // every mirrored workgroup, no enrichment) to close the historical
    // coverage gap. ?groups=654,584 chunks it to specific workgroups so a
    // big portal can be backfilled in bounded slices.
    const backfillParam = url.searchParams.get('backfill');
    const backfill = backfillParam === '1' || backfillParam === 'true';
    const groupsParam = url.searchParams.get('groups');
    const groupIds = groupsParam
      ? groupsParam
          .split(',')
          .map((s) => s.trim())
          // Workgroup ids are numeric — drop anything else so a malformed
          // ?groups= can't reach the Bitrix filter as junk.
          .filter((s) => /^\d+$/.test(s))
      : undefined;
    const result = await runBitrix24SyncNow({ force, backfill, groupIds });
    // Mirror each user's Bitrix24 personal calendar (read-only). Non-fatal: a
    // calendar API failure must not fail the task sync. Skipped on backfill runs
    // (those are a one-off task-only pass).
    let calendar = { users: 0, events: 0, deleted: 0, errors: [] as string[] };
    if (!backfill) {
      try {
        // Hard deadline so the per-user calendar loop can't blow the function's
        // 300s budget on a large org — a partial pass is safe (idempotent).
        calendar = await syncBitrixCalendarNow({ signal: AbortSignal.timeout(120_000) });
      } catch (e) {
        calendar.errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    return NextResponse.json({
      ok: result.ok,
      force,
      backfill,
      durationMs: result.durationMs,
      users: result.users,
      projects: result.projects,
      tasks: result.tasks,
      calendar: { events: calendar.events, deleted: calendar.deleted, errors: calendar.errors.length },
      error: result.error,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

// Convenience GET so curl-ing manually works the same way.
export const GET = POST;
