import crypto from 'node:crypto';
import { prisma } from '@giper/db';
import { isSafeWebhookUrl } from './ssrfGuard';
import type { WebhookEvent } from './events';

const TIMEOUT_MS = 5000;

type HookRow = { id: string; url: string; secret: string };

/**
 * Fire all active webhooks in `projectId` that are subscribed to `event`.
 * Best-effort by contract: never throws — a webhook failure must never affect
 * the card/board action that triggered it. Each delivery is HMAC-SHA256 signed
 * over the body (X-Giper-Signature: sha256=<hex>), 5s timeout, no redirects.
 */
export async function dispatchWebhooks(
  projectId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const hooks = await prisma.webhook.findMany({
      where: { projectId, active: true, events: { has: event } },
      select: { id: true, url: true, secret: true },
    });
    if (hooks.length === 0) return;
    const body = JSON.stringify({ event, firedAt: new Date().toISOString(), ...payload });
    await Promise.all(hooks.map((h) => deliver(h, event, body)));
  } catch (e) {
    console.warn('dispatchWebhooks failed', e);
  }
}

async function deliver(hook: HookRow, event: string, body: string): Promise<void> {
  let status: number | null = null;
  let error: string | null = null;
  try {
    if (!isSafeWebhookUrl(hook.url)) {
      error = 'URL заблокирован (внутренний адрес)';
    } else {
      const sig = crypto.createHmac('sha256', hook.secret).update(body).digest('hex');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(hook.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'X-Giper-Event': event,
            'X-Giper-Signature': `sha256=${sig}`,
          },
          body,
          signal: ctrl.signal,
          redirect: 'manual',
        });
        status = res.status;
        if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
      } finally {
        clearTimeout(timer);
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 200) : 'ошибка доставки';
  }
  await prisma.webhook
    .update({
      where: { id: hook.id },
      data: { lastStatus: status, lastError: error, lastFiredAt: new Date() },
    })
    .catch(() => {});
}
