import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { runAllKaitenSyncs } from '@/lib/integrations/kaiten';

/**
 * Cron-callable endpoint for the Kaiten → giper-pm card mirror. Auth: shared
 * secret in `Authorization: Bearer <CRON_SECRET>`. Runs a reconciling sync for
 * every connected project (imports new/changed live cards, fuzzy-matches Bitrix
 * twins, reflects archived cards' final state). POST only. Schedule it hourly
 * via host cron.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

/** Stop launching new project syncs with this much headroom before maxDuration. */
const SOFT_DEADLINE_MS = 560_000;

function checkAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false; // refuse if not configured
  const provided = req.headers.get('authorization');
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  // Bound the whole run so a slow board can't orphan in-flight work at the
  // platform timeout; runAllKaitenSyncs stops launching new syncs when aborted.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SOFT_DEADLINE_MS);
  try {
    const results = await runAllKaitenSyncs({ signal: ctrl.signal });
    return NextResponse.json({
      ok: results.every((r) => r.ok || r.skipped),
      projects: results.length,
      synced: results.filter((r) => r.ok).length,
      skipped: results.filter((r) => r.skipped).length,
      results,
    });
  } finally {
    clearTimeout(timer);
  }
}
