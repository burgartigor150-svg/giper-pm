import { NextResponse } from 'next/server';
import { runTeamlySyncNow } from '@/lib/integrations/teamly';

/**
 * Cron-callable endpoint for the TEAMLY → KB mirror. Auth: shared secret in
 * `Authorization: Bearer <CRON_SECRET>`. Runs an incremental sync (only changed
 * articles re-fetched) + reconcile (propagate source deletions). `?force=1`
 * re-fetches every article. Schedule it hourly/daily via the host cron — this
 * also keeps the 2-week refresh token alive.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function checkAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false; // refuse if not configured
  return req.headers.get('authorization') === `Bearer ${expected}`;
}

export async function POST(req: Request) {
  if (!checkAuth(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const force = ['1', 'true'].includes(new URL(req.url).searchParams.get('force') ?? '');
  try {
    const res = await runTeamlySyncNow({ force });
    return NextResponse.json({
      ok: res.ok,
      skipped: res.skipped ?? false,
      summary: res.summary,
      ...(res.result
        ? {
            spaces: res.result.spaces,
            articles: res.result.articles,
            tables: res.result.tables,
            tableRows: res.result.tableRows,
            archived: res.result.archived,
            durationMs: res.result.durationMs,
            errors: res.result.errors.length,
          }
        : {}),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// Convenience GET so curl works the same way.
export const GET = POST;
