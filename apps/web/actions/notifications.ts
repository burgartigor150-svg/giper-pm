'use server';

import { prisma } from '@giper/db';
import { mintWsToken } from '@giper/realtime/token';
import { revalidatePath } from 'next/cache';
import { requireAuth } from '@/lib/auth';

export type NotificationListItem = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  isRead: boolean;
  createdAt: Date;
};

/**
 * Server action used by the inbox dropdown. Returns the most recent
 * notifications (read + unread) for the current user, capped to keep
 * the dropdown light. Caller (the InboxBell client component) refreshes
 * this list on demand and on `notification:new` realtime events.
 */
export async function getMyNotifications(): Promise<{
  items: NotificationListItem[];
  unread: number;
}> {
  const me = await requireAuth();
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: me.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        kind: true,
        title: true,
        body: true,
        link: true,
        isRead: true,
        createdAt: true,
      },
    }),
    prisma.notification.count({
      where: { userId: me.id, isRead: false },
    }),
  ]);
  return { items, unread };
}

/**
 * Mark a single notification as read. Used when the user clicks an
 * inbox row — we navigate them to the link and clear the bullet.
 */
export async function markNotificationReadAction(notificationId: string) {
  const me = await requireAuth();
  await prisma.notification.updateMany({
    where: { id: notificationId, userId: me.id, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  revalidatePath('/');
  return { ok: true } as const;
}

/**
 * Mark every unread notification as read in one go. The "Прочитать всё"
 * button in the dropdown.
 */
export async function markAllNotificationsReadAction() {
  const me = await requireAuth();
  await prisma.notification.updateMany({
    where: { userId: me.id, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  revalidatePath('/');
  return { ok: true } as const;
}

/**
 * Server-issued WS-auth token. The browser fetches this just before
 * opening the WebSocket. JWT signed with WS_AUTH_SECRET, 15 min TTL.
 *
 * Throws if the realtime stack isn't configured — the client treats
 * that as "no real-time, fall back to polling".
 */
export async function getWsTokenAction(): Promise<{ token: string; url: string }> {
  const me = await requireAuth();
  const secret = process.env.WS_AUTH_SECRET?.trim();
  const url = process.env.NEXT_PUBLIC_WS_URL?.trim();
  if (!secret || !url) {
    throw new Error('Realtime not configured');
  }
  const token = await mintWsToken({ userId: me.id, secret });
  return { token, url };
}
