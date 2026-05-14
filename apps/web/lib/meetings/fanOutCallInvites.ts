import { prisma } from '@giper/db';

/**
 * Fan-out call invites across three independent channels:
 *
 *   1. Web Push   — OS-level toast for unmuted recipients (best for
 *                   ringing-on-screen UX when the app is closed).
 *   2. In-app row — Notification record so the bell reflects history
 *                   even when push is dead/unconfigured. Fires for
 *                   everyone, muted or not — silent UI.
 *   3. Bitrix24   — personal IM to the user's Bitrix24 inbox via
 *                   im.notify.personal.add. Most people live in
 *                   Bitrix and this is the canonical "they pinged me"
 *                   channel here.
 *
 * Each channel is fired with its own try/catch so a failure in one
 * doesn't sink the others. The caller awaits this only if it wants
 * delivery confirmation — typical use is `void fanOutCallInvites(...)`
 * so the action returns immediately.
 *
 * `muted` filter:
 *   - For channel-originated calls we honor ChannelMember.isMuted.
 *   - For ad-hoc group calls there's no channel, so caller passes the
 *     list as already-filtered + a flat `muted: false` for everyone.
 *
 * `callerName` is purely cosmetic — used in the push title. Pass null
 * if there's no caller (system-initiated calls).
 */
export type InviteRecipient = {
  userId: string;
  isMuted: boolean;
  bitrixUserId: string | null;
};

export async function fanOutCallInvites(args: {
  meetingId: string;
  /** Cosmetic meeting title — shown in push body and Bitrix message. */
  title: string;
  /** Name of the person who started the call. */
  callerName: string | null;
  /** Channel id, if this call lives in a chat. Stored in payload for
   *  the inbox so the bell can deep-link back to the channel. */
  channelId?: string | null;
  recipients: InviteRecipient[];
}): Promise<void> {
  const { meetingId, title, callerName, channelId, recipients } = args;
  if (recipients.length === 0) return;

  const meetingUrl = `/meetings/${meetingId}`;
  const pushTitle = `${callerName ?? 'Кто-то'} зовёт на звонок`;
  const unmuted = recipients.filter((r) => !r.isMuted);

  // Load implementations lazily so this helper is safe to import from
  // server actions without dragging next-auth/realtime/webpush graph
  // into edge-runtime modules.
  const [{ sendPushToUsers }, { createNotification }, { notifyBitrixPersonalBestEffort }] =
    await Promise.all([
      import('@/lib/push/sendPush'),
      import('@/lib/notifications/createNotifications'),
      import('@/lib/integrations/bitrix24Outbound'),
    ]);

  // 1. Web Push (unmuted only).
  const pushPromise = sendPushToUsers(
    unmuted.map((r) => r.userId),
    {
      title: pushTitle,
      body: title,
      url: meetingUrl,
      tag: `call:${meetingId}`,
      data: { meetingId },
    },
  ).catch((e) => {
    // eslint-disable-next-line no-console
    console.warn('[meetings] web push failed:', e);
  });

  // 2. In-app inbox rows (everyone, including muted).
  const inAppPromises = recipients.map((r) =>
    createNotification({
      userId: r.userId,
      kind: 'CALL_INVITE',
      title: pushTitle,
      body: title,
      link: meetingUrl,
      payload: { meetingId, channelId: channelId ?? null },
    }).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[meetings] in-app notif failed for', r.userId, e);
      return null;
    }),
  );

  // 3. Bitrix24 IM (unmuted, only those with a known bitrixUserId).
  const base =
    process.env.PUBLIC_BASE_URL?.trim() || 'https://pm.since-b24-ru.ru';
  const bitrixMsg = `📞 ${pushTitle}\n${title}\nПрисоединиться: ${base}${meetingUrl}`;
  const bitrixPromises = unmuted
    .filter((r) => r.bitrixUserId)
    .map((r) => notifyBitrixPersonalBestEffort(r.bitrixUserId!, bitrixMsg));

  try {
    await Promise.all([pushPromise, ...inAppPromises, ...bitrixPromises]);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[meetings] fan-out failed:', e);
  }
}

/**
 * Convenience: load recipients for a channel-originated call.
 * Excludes the caller, joins ChannelMember.isMuted and User.bitrixUserId
 * so the shapes line up with InviteRecipient.
 */
export async function recipientsFromChannel(
  channelId: string,
  excludeUserId: string,
): Promise<InviteRecipient[]> {
  const rows = await prisma.channelMember.findMany({
    where: { channelId, userId: { not: excludeUserId } },
    select: {
      userId: true,
      isMuted: true,
      user: { select: { bitrixUserId: true } },
    },
  });
  return rows.map((r) => ({
    userId: r.userId,
    isMuted: r.isMuted,
    bitrixUserId: r.user.bitrixUserId,
  }));
}

/**
 * Convenience: load recipients for a list of explicitly chosen user ids
 * (ad-hoc group call). Ignores the caller, drops inactive users.
 * No mute concept here — ad-hoc invites are always intentional, so the
 * full three-channel ping fires.
 */
export async function recipientsFromUserIds(
  userIds: string[],
  excludeUserId: string,
): Promise<InviteRecipient[]> {
  const cleaned = Array.from(new Set(userIds)).filter((id) => id !== excludeUserId);
  if (cleaned.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: cleaned }, isActive: true },
    select: { id: true, bitrixUserId: true },
  });
  return users.map((u) => ({
    userId: u.id,
    isMuted: false,
    bitrixUserId: u.bitrixUserId,
  }));
}
