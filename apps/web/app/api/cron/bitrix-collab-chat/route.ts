import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { runCollabChatSync } from '@/lib/integrations/bitrixCollabChat';

/**
 * Cron: mirror Bitrix24 collab group chats → per-project messenger Channels.
 * Auth: Bearer CRON_SECRET. POST only. Schedule hourly via host cron.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 600;
const SOFT_DEADLINE_MS = 560_000;

function checkAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const provided = req.headers.get('authorization');
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SOFT_DEADLINE_MS);
  try {
    const res = await runCollabChatSync({ signal: ctrl.signal });
    return NextResponse.json({ ok: res.errors === 0, ...res });
  } finally {
    clearTimeout(timer);
  }
}
