import webpush from 'web-push';
import { prisma } from '@giper/db';

/**
 * Web Push delivery helpers. Sits between the action layer
 * (assignTask, startCall, etc.) and the web-push library so the
 * VAPID setup happens once, errors are normalised, and dead
 * subscriptions get pruned automatically.
 *
 * Env contract (see .env.example):
 *   - VAPID_PUBLIC_KEY   — base64-url, exposed to clients via /api/push/vapid-public-key
 *   - VAPID_PRIVATE_KEY  — base64-url, NEVER expose
 *   - VAPID_SUBJECT      — "mailto:postmaster@<domain>" — required by spec, used by push services for abuse contact
 */

let _ready = false;
function ensureConfigured() {
  if (_ready) return;
  const pub = process.env.VAPID_PUBLIC_KEY?.trim();
  const priv = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:postmaster@since-b24-ru.ru';
  if (!pub || !priv) {
    throw new Error(
      'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — push delivery disabled',
    );
  }
  webpush.setVapidDetails(subject, pub, priv);
  _ready = true;
}

export type PushPayload = {
  /** Headline on the notification. */
  title: string;
  /** Subtitle/body line. */
  body?: string;
  /**
   * Path inside our app the click handler should navigate to. The
   * service worker resolves it as same-origin so we never leak
   * users to phishing via crafted payloads.
   */
  url?: string;
  /**
   * Notification tag. Same tag collapses on the OS so a burst of
   * "Игорь начал звонок" doesn't pile up four toasts. We use
   * "call:<meetingId>" / "msg:<channelId>" naming.
   */
  tag?: string;
  /** Icon override; defaults to the giper-pm favicon. */
  icon?: string;
  /** Extra data stored on the Notification, available in click handler. */
  data?: Record<string, unknown>;
};

/**
 * Send a push notification to every active subscription of `userId`.
 * Dead endpoints (410 / 404) are deleted from the DB so we don't
 * keep retrying. Other errors are logged but don't fail the caller —
 * push is best-effort, not a strong delivery channel.
 *
 * Resolves to the number of successful deliveries (mostly for tests
 * and logging; callers usually don't await).
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<number> {
  try {
    ensureConfigured();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[push] not configured:', e instanceof Error ? e.message : e);
    return 0;
  }
  const subs = await prisma.pushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, p256dh: true, authSec: true },
  });
  if (subs.length === 0) return 0;
  const body = JSON.stringify(payload);
  let sent = 0;
  const deadIds: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.authSec },
          },
          body,
          { TTL: 60 /* drop the push if undelivered after 1 min */ },
        );
        sent++;
      } catch (e) {
        const status =
          (e as { statusCode?: number } | null)?.statusCode ?? 0;
        if (status === 404 || status === 410) {
          // Subscription is gone (uninstalled, blocked, expired).
          // Cull so we don't keep pinging into the void.
          deadIds.push(s.id);
        } else {
          // eslint-disable-next-line no-console
          console.warn(
            `[push] delivery to ${s.endpoint.slice(0, 60)}… failed (status=${status}):`,
            e instanceof Error ? e.message : e,
          );
        }
      }
    }),
  );
  if (deadIds.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: deadIds } } });
  }
  if (sent > 0) {
    await prisma.pushSubscription.updateMany({
      where: { userId, id: { notIn: deadIds } },
      data: { lastUsedAt: new Date() },
    });
  }
  return sent;
}

/**
 * Multi-recipient variant. Cheaper than calling sendPushToUser in
 * a loop because the VAPID-setup check runs once and recipients are
 * fanned out in parallel.
 */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload,
): Promise<number> {
  if (userIds.length === 0) return 0;
  const unique = Array.from(new Set(userIds));
  const counts = await Promise.all(unique.map((u) => sendPushToUser(u, payload)));
  return counts.reduce((a, b) => a + b, 0);
}
