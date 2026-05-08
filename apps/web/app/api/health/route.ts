import { NextResponse } from 'next/server';

/**
 * Liveness/health endpoint for the docker HEALTHCHECK and any uptime
 * monitor. Returns 200 with a tiny JSON immediately, no DB hit, no
 * middleware redirect, no auth — that's the whole point.
 *
 * Whitelisted in middleware.ts alongside /api/cron and /api/webhooks
 * so the probe never gets bounced to /login.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET() {
  return NextResponse.json({ ok: true, ts: Date.now() });
}

export const HEAD = GET;
