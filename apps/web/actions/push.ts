'use server';

import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

/**
 * Persist a Push subscription handed back by the browser
 * (PushManager.subscribe). One subscription per (endpoint), and we
 * upsert by endpoint so re-subscribing the same browser doesn't
 * pile up duplicate rows.
 */
export async function subscribePushAction(input: {
  endpoint: string;
  p256dh: string;
  authSec: string;
  userAgent?: string;
}): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  if (!input.endpoint || !input.p256dh || !input.authSec) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Неполные данные подписки' } };
  }
  // Defensive: don't store absurdly large payloads.
  if (input.endpoint.length > 1000 || input.p256dh.length > 200 || input.authSec.length > 200) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Слишком длинная подписка' } };
  }
  const sub = await prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: {
      userId: me.id,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      authSec: input.authSec,
      userAgent: input.userAgent?.slice(0, 500),
    },
    // Re-bind to current user if a previous subscription on this
    // endpoint was tied to a different account (e.g. shared device).
    update: {
      userId: me.id,
      p256dh: input.p256dh,
      authSec: input.authSec,
      userAgent: input.userAgent?.slice(0, 500),
    },
    select: { id: true },
  });
  return { ok: true, data: sub };
}

/**
 * Drop a subscription. Called when the user toggles push off in
 * settings, OR when the browser tells us PushManager.getSubscription()
 * returned null after a permission revocation.
 */
export async function unsubscribePushAction(
  endpoint: string,
): Promise<ActionResult> {
  const me = await requireAuth();
  await prisma.pushSubscription
    .deleteMany({ where: { endpoint, userId: me.id } })
    .catch(() => null);
  return { ok: true };
}

/**
 * Status query for the opt-in banner / settings toggle.
 *
 * The browser already knows whether THIS browser is subscribed via
 * PushManager.getSubscription(); but the settings UI also wants the
 * count of active subscriptions across all the user's devices.
 */
export async function listMyPushSubscriptionsAction(): Promise<
  ActionResult<{
    count: number;
    devices: Array<{ id: string; userAgent: string | null; createdAt: Date }>;
  }>
> {
  const me = await requireAuth();
  const rows = await prisma.pushSubscription.findMany({
    where: { userId: me.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, userAgent: true, createdAt: true },
  });
  return { ok: true, data: { count: rows.length, devices: rows } };
}
