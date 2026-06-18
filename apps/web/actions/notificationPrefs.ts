'use server';

import { revalidatePath } from 'next/cache';
import { prisma, type NotificationKind } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { NOTIFICATION_KINDS } from '@/lib/notifications/kinds';

type ActionResult = { ok: true } | { ok: false; error: { code: string; message: string } };

export type NotificationPreferenceInput = {
  kind: NotificationKind;
  inApp: boolean;
};

const VALID_KINDS = new Set<string>(NOTIFICATION_KINDS);

/**
 * Save the current user's per-kind in-app notification preferences. Upserts a
 * row per provided kind (unknown kinds are rejected). Only the acting user's
 * own preferences are touched — no userId is accepted from the client.
 */
export async function setNotificationPreferencesAction(
  prefs: NotificationPreferenceInput[],
): Promise<ActionResult> {
  const me = await requireAuth();

  for (const p of prefs) {
    if (!VALID_KINDS.has(p.kind)) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Неизвестный тип уведомления' } };
    }
  }

  await prisma.$transaction(
    prefs.map((p) =>
      prisma.notificationPreference.upsert({
        where: { userId_kind: { userId: me.id, kind: p.kind } },
        create: { userId: me.id, kind: p.kind, inApp: p.inApp },
        update: { inApp: p.inApp },
      }),
    ),
  );

  revalidatePath('/settings');
  revalidatePath('/me/notifications');
  return { ok: true };
}
