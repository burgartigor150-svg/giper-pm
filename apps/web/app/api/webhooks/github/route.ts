import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { handlePullRequest, handlePush } from '@/lib/integrations/github/handlers';
import { publishTaskEvent } from '@/lib/realtime/publishTask';

/**
 * GitHub webhook receiver. Configured in repo settings as
 *   https://<our-host>/api/webhooks/github
 *   Content-Type: application/json
 *   Secret: GITHUB_WEBHOOK_SECRET (env)
 *   Events: Push + Pull request
 *
 * Auth: HMAC-SHA256 of the raw body, compared in constant time. We
 * also accept-but-ignore unknown events so adding new GH event types
 * later doesn't 4xx the deliveries.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'not configured' }, { status: 503 });
  }

  const sigHeader = req.headers.get('x-hub-signature-256') ?? '';
  const event = req.headers.get('x-github-event') ?? '';
  const raw = await req.text();

  if (!verifySignature(raw, secret, sigHeader)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: 'bad json' }, { status: 400 });
  }

  try {
    if (event === 'push') {
      const result = await handlePush(payload as Parameters<typeof handlePush>[0]);
      // Best-effort live update on every task touched. We don't have
      // their ids without re-querying, so we revalidate the project
      // list pages instead — cheap.
      revalidatePath('/');
      return NextResponse.json({ ok: true, event, ...result });
    }

    if (event === 'pull_request') {
      const result = await handlePullRequest(
        payload as Parameters<typeof handlePullRequest>[0],
      );
      // Pulse the task channels so the PR badge appears live on open
      // task pages.
      const taskIds = await prisma.taskPullRequest.findMany({
        where: {
          repo: (payload as { repository?: { full_name?: string } }).repository
            ?.full_name,
          number: (payload as { pull_request?: { number?: number } }).pull_request
            ?.number,
        },
        select: { taskId: true },
      });
      for (const t of taskIds) {
        void publishTaskEvent(t.taskId, { type: 'task:pr-updated', taskId: t.taskId });
      }
      return NextResponse.json({ ok: true, event, ...result });
    }

    if (event === 'ping') {
      return NextResponse.json({ ok: true, pong: true });
    }

    // Unknown / unhandled event — ack so GitHub doesn't retry forever.
    return NextResponse.json({ ok: true, event, action: 'ignored' });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('github webhook error', event, e);
    return NextResponse.json(
      { ok: false, event, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

/**
 * Constant-time HMAC verification. GitHub sends `sha256=<hex>` in
 * x-hub-signature-256. We compute over the raw body and compare.
 */
function verifySignature(body: string, secret: string, header: string): boolean {
  if (!header.startsWith('sha256=')) return false;
  const provided = header.slice('sha256='.length);
  const computed = createHmac('sha256', secret).update(body).digest('hex');
  if (provided.length !== computed.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(computed, 'hex'));
  } catch {
    return false;
  }
}
