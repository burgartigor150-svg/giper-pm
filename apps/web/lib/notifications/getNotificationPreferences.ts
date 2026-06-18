import { prisma, type NotificationKind } from '@giper/db';

/** Map of NotificationKind → in-app delivery flag. Absent key = default (true). */
export type NotifPrefMap = Partial<Record<NotificationKind, boolean>>;

/**
 * Load a user's per-kind in-app notification preferences. Fault-tolerant:
 * returns {} if the table isn't there yet (image live a beat before migrate
 * deploy) so the settings page never 500s over preferences.
 */
export async function getNotificationPreferences(userId: string): Promise<NotifPrefMap> {
  try {
    const rows = await prisma.notificationPreference.findMany({
      where: { userId },
      select: { kind: true, inApp: true },
    });
    const map: NotifPrefMap = {};
    for (const r of rows) map[r.kind] = r.inApp;
    return map;
  } catch (e) {
    console.warn('getNotificationPreferences: unavailable', e);
    return {};
  }
}
