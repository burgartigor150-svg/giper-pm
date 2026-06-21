import { NextResponse } from 'next/server';
import { prisma } from '@giper/db';
import { getBitrix24Client } from '@/lib/integrations/bitrix24';
import { backfillAdminAttributedComments } from '@giper/integrations/bitrix24';

/**
 * One-off, resumable backfill: re-resolve the author of Bitrix-mirrored comments
 * still pinned on a Bitrix-LINKED admin (which the DB migration couldn't safely
 * touch). Re-syncs the affected tasks directly — bypasses the group/CHANGED_DATE
 * coverage that makes a full sync miss old tasks. Bounded by ?limit so it can't
 * time out; call again with ?after=<nextCursor> until {done:true}.
 *
 * Auth: Authorization: Bearer <CRON_SECRET> (same as the bitrix24 cron).
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function checkAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get('authorization') === `Bearer ${expected}`;
}

async function handle(req: Request) {
  if (!checkAuth(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get('limit') ?? '100') || 100;
    const after = url.searchParams.get('after') ?? undefined;
    const client = getBitrix24Client();
    const result = await backfillAdminAttributedComments(prisma, client, { limit, after });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export const POST = handle;
export const GET = handle;
