'use server';

import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { getBitrix24Client } from '@/lib/integrations/bitrix24';
import { backfillAdminAttributedComments } from '@giper/integrations/bitrix24';

type Result =
  | { ok: true; processed: number; nextCursor: string | null; done: boolean }
  | { ok: false; error: string };

/**
 * Admin-only: one batch of the targeted "reattribute Bitrix robot/system
 * comments off a real admin → the Bitrix24 bot" backfill. Bounded so it returns
 * quickly; the caller re-invokes with the returned cursor until `done`. Gated by
 * the logged-in admin session (no CRON_SECRET needed) — this is the click-a-button
 * path for the maintenance route /api/cron/backfill-comment-authors.
 */
export async function backfillBitrixCommentAuthorsAction(after?: string): Promise<Result> {
  const me = await requireAuth();
  if (me.role !== 'ADMIN') {
    return { ok: false, error: 'Только администратор' };
  }
  try {
    const client = getBitrix24Client();
    const res = await backfillAdminAttributedComments(prisma, client, { limit: 100, after });
    return { ok: true, processed: res.processed, nextCursor: res.nextCursor, done: res.done };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
