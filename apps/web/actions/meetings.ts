'use server';

import { revalidatePath } from 'next/cache';
import { Redis } from 'ioredis';
import { prisma } from '@giper/db';
import {
  buildTurnCredentials,
  livekitPublicUrl,
  mintAccessToken,
  stopEgress,
  type IceServer,
} from '@giper/integrations';
import { requireAuth } from '@/lib/auth';
import { canManageAssignments, canSeeSettings } from '@/lib/permissions';

let _redis: Redis | null = null;
function redis(): Redis {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');
  _redis = new Redis(url);
  return _redis;
}

const TRANSCRIBE_CHANNEL = 'meeting:transcribe';

function newRoomName(meetingId: string): string {
  // LiveKit room names are arbitrary strings — use the meeting id with
  // an `m_` prefix to make logs grep-friendly.
  return `m_${meetingId}`;
}

export async function createMeetingAction({
  projectKey,
  title,
}: {
  projectKey?: string | null;
  title: string;
}): Promise<
  | { ok: true; meeting: { id: string; livekitRoomName: string; title: string } }
  | { ok: false; message: string }
> {
  const me = await requireAuth();
  if (!canSeeSettings({ id: me.id, role: me.role })) {
    return { ok: false, message: 'Создавать встречи могут только PM или администратор' };
  }
  const cleanTitle = title.trim().slice(0, 200);
  if (cleanTitle.length < 2) return { ok: false, message: 'Название встречи слишком короткое' };

  let projectId: string | null = null;
  if (projectKey) {
    const p = await prisma.project.findUnique({
      where: { key: projectKey },
      select: { id: true, ownerId: true, members: { select: { userId: true, role: true } } },
    });
    if (!p) return { ok: false, message: 'Проект не найден' };
    if (!canManageAssignments({ id: me.id, role: me.role }, p)) {
      return { ok: false, message: 'Нет прав на этот проект' };
    }
    projectId = p.id;
  }

  const meeting = await prisma.meeting.create({
    data: {
      projectId,
      title: cleanTitle,
      status: 'PLANNED',
      kind: 'VIDEO_LIVEKIT',
      createdById: me.id,
    },
    select: { id: true },
  });
  const livekitRoomName = newRoomName(meeting.id);
  await prisma.meeting.update({
    where: { id: meeting.id },
    data: { livekitRoomName },
  });
  revalidatePath('/meetings');
  if (projectKey) revalidatePath(`/projects/${projectKey}`);
  return { ok: true, meeting: { id: meeting.id, livekitRoomName, title: cleanTitle } };
}

/**
 * Start a video call attached to a chat channel ("Позвонить" from
 * the chat header). Creates a Meeting with channelId set, drops a
 * SYSTEM message with eventKind=CALL_STARTED into the chat so every
 * participant sees a join card in realtime, and (optionally) pings
 * the other DM party via Telegram bot if they have one linked.
 *
 * Permission: any channel member can start a call. The action does
 * NOT auto-join the caller — the UI redirects to /meetings/<id>
 * which mints the join token via joinMeetingAction.
 *
 * Side effects all live in one transaction so a partial fail
 * (e.g. the meeting row is created but the system message blows
 * up) can be rolled back together — otherwise we'd have orphan
 * meetings in the dashboard and confused participants.
 */
export async function startCallInChannelAction(input: {
  channelId: string;
}): Promise<
  | { ok: true; meetingId: string }
  | { ok: false; message: string }
> {
  const me = await requireAuth();
  const { resolveChannelAccess } = await import('@/lib/messenger/access');
  const { publishChatEvent } = await import('@/lib/realtime/publishChat');

  const access = await resolveChannelAccess(input.channelId, me.id);
  if (!access) return { ok: false, message: 'Канал не найден' };
  if (!access.canPost) {
    return { ok: false, message: 'Нет прав на запись в этот канал' };
  }

  const channel = await prisma.channel.findUnique({
    where: { id: input.channelId },
    select: {
      id: true,
      name: true,
      kind: true,
      // For the system-message title we want "Звонок в #project-x" /
      // "Звонок с Игорь" — depends on channel kind.
      members: {
        select: { user: { select: { id: true, name: true } } },
        take: 5,
      },
    },
  });
  if (!channel) return { ok: false, message: 'Канал не найден' };

  // Reject duplicate active call in the same channel. Two concurrent
  // LiveKit rooms in one DM is confusing; the existing one wins and
  // the caller is told to join it.
  const existing = await prisma.meeting.findFirst({
    where: {
      channelId: input.channelId,
      status: { in: ['PLANNED', 'ACTIVE'] },
    },
    select: { id: true },
  });
  if (existing) {
    return { ok: true, meetingId: existing.id };
  }

  // Title heuristic. For DM use the other party's name; for named
  // channels, "Звонок: <name>". Falls back to "Звонок" when neither
  // applies (shouldn't, but keeps the column NOT NULL happy).
  let title = 'Звонок';
  if (channel.kind === 'DM') {
    const other = channel.members.find((m) => m.user.id !== me.id);
    if (other) title = `Звонок с ${other.user.name}`;
  } else if (channel.name) {
    title = `Звонок: ${channel.name}`;
  }

  const created = await prisma.$transaction(async (tx) => {
    const meeting = await tx.meeting.create({
      data: {
        title: title.slice(0, 200),
        kind: 'VIDEO_LIVEKIT',
        status: 'PLANNED',
        createdById: me.id,
        channelId: input.channelId,
      },
      select: { id: true },
    });
    const livekitRoomName = newRoomName(meeting.id);
    await tx.meeting.update({
      where: { id: meeting.id },
      data: { livekitRoomName },
    });
    const systemMsg = await tx.message.create({
      data: {
        channelId: input.channelId,
        authorId: me.id,
        body: '', // payload-driven card; body is unused for system events
        source: 'SYSTEM',
        eventKind: 'CALL_STARTED',
        eventPayload: { meetingId: meeting.id, livekitRoomName, title },
      },
      select: { id: true },
    });
    await tx.channel.update({
      where: { id: input.channelId },
      data: { updatedAt: new Date() },
    });
    return { meetingId: meeting.id, systemMsgId: systemMsg.id, livekitRoomName };
  });

  await publishChatEvent({
    kind: 'message.new',
    channelId: input.channelId,
    messageId: created.systemMsgId,
    authorId: me.id,
    parentId: null,
  });

  // Fan-out invites across three channels in parallel. Each is
  // best-effort and isolated so a failure in one channel (e.g. VAPID
  // unconfigured, Bitrix outage) never blocks the call from starting
  // or the other channels from firing.
  //
  //   1. Web Push    — OS-level "X is calling you" toast
  //   2. In-app row  — Notification record visible in the bell
  //   3. Bitrix IM   — personal message in the user's Bitrix24 inbox
  //
  // Recipients: every channel member except the caller. Muted members
  // still get the in-app row (so they can find the call in their
  // inbox), but no Web Push and no Bitrix IM ping.
  void (async () => {
    try {
      const recipients = await prisma.channelMember.findMany({
        where: { channelId: input.channelId, userId: { not: me.id } },
        select: {
          userId: true,
          isMuted: true,
          user: { select: { bitrixUserId: true } },
        },
      });
      const meetingUrl = `/meetings/${created.meetingId}`;
      const pushTitle = `${me.name ?? 'Кто-то'} зовёт на звонок`;
      const unmuted = recipients.filter((r) => !r.isMuted);

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
          tag: `call:${created.meetingId}`,
          data: { meetingId: created.meetingId },
        },
      ).catch((e) => {
        // eslint-disable-next-line no-console
        console.warn('[meetings] web push failed:', e);
      });

      // 2. In-app inbox row (everyone, including muted — the bell is
      //    silent UI). Per-user so dedupe works correctly.
      const inAppPromises = recipients.map((r) =>
        createNotification({
          userId: r.userId,
          kind: 'CALL_INVITE',
          title: pushTitle,
          body: title,
          link: meetingUrl,
          payload: { meetingId: created.meetingId, channelId: input.channelId },
        }).catch((e) => {
          // eslint-disable-next-line no-console
          console.warn('[meetings] in-app notif failed for', r.userId, e);
          return null;
        }),
      );

      // 3. Bitrix24 IM (unmuted, with a known bitrixUserId only).
      const base =
        process.env.PUBLIC_BASE_URL?.trim() || 'https://pm.since-b24-ru.ru';
      const bitrixMsg = `📞 ${pushTitle}\n${title}\nПрисоединиться: ${base}${meetingUrl}`;
      const bitrixPromises = unmuted
        .filter((r) => r.user.bitrixUserId)
        .map((r) =>
          notifyBitrixPersonalBestEffort(r.user.bitrixUserId!, bitrixMsg),
        );

      await Promise.all([pushPromise, ...inAppPromises, ...bitrixPromises]);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[meetings] fan-out failed:', e);
    }
  })();

  revalidatePath(`/messages/${input.channelId}`);
  revalidatePath('/meetings');
  return { ok: true, meetingId: created.meetingId };
}

/**
 * Mint a LiveKit access token for the caller and (lazily) kick off
 * composite recording on the first join.
 */
export async function joinMeetingAction({
  meetingId,
}: {
  meetingId: string;
}): Promise<
  | {
      ok: true;
      token: string;
      serverUrl: string;
      identity: string;
      displayName: string;
      iceServers: IceServer[];
      meeting: { id: string; title: string; status: string };
    }
  | { ok: false; message: string }
> {
  const me = await requireAuth();
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: {
      id: true,
      title: true,
      status: true,
      livekitRoomName: true,
      livekitEgressId: true,
      recordingKey: true,
      createdById: true,
      channelId: true,
      project: {
        select: { ownerId: true, members: { select: { userId: true, role: true } } },
      },
    },
  });
  if (!meeting || !meeting.livekitRoomName) {
    return { ok: false, message: 'Встреча не найдена' };
  }
  if (meeting.status === 'ENDED' || meeting.status === 'PROCESSING' || meeting.status === 'READY') {
    return { ok: false, message: 'Встреча уже закончилась — посмотрите запись на странице карточки.' };
  }
  // Permissions: creator, project member, channel member, or admin.
  // Chat-originated meetings (channelId set) inherit visibility from
  // the channel — anyone who can read the chat can join the call.
  let channelAllowed = false;
  if (meeting.channelId) {
    const { resolveChannelAccess } = await import('@/lib/messenger/access');
    const acc = await resolveChannelAccess(meeting.channelId, me.id);
    channelAllowed = !!acc?.canRead;
  }
  const allowed =
    me.role === 'ADMIN' ||
    meeting.createdById === me.id ||
    channelAllowed ||
    (meeting.project &&
      canManageAssignments({ id: me.id, role: me.role }, meeting.project));
  if (!allowed) return { ok: false, message: 'Нет прав на эту встречу' };

  // Identity must be UNIQUE per session, not per user. The page
  // (`/meetings/[id]`) is a force-dynamic Server Component — every
  // render mints a fresh token. If two renders end up with the same
  // identity, LiveKit kicks the older socket ("identity reused")
  // and the user gets "выкидывает через минуту". Suffix a short
  // nonce so each WebRTC connect is its own participant; the webhook
  // strips the suffix to recover the underlying userId.
  const nonce = Math.random().toString(36).slice(2, 10);
  const identity = `user:${me.id}:${nonce}`;
  const displayName = (me.name || me.email || 'PM').slice(0, 80);
  const token = await mintAccessToken({
    roomName: meeting.livekitRoomName,
    identity,
    displayName,
    canPublish: true,
  });

  // NOTE: We do NOT start composite recording here. Calling
  // startEgress before the room actually exists in LiveKit (which
  // happens only after the first WebRTC connect from the browser)
  // returns 404 "requested room does not exist". Egress is started
  // by the webhook handler on `participant_joined` instead — see
  // apps/web/app/api/livekit/webhook/route.ts.

  // ICE servers (STUN + TURN). With TURN configured this lets clients
  // behind symmetric NAT / corporate firewalls connect via the TURN
  // relay (UDP, TCP, or TLS-on-5349 fallback).
  const iceServers = buildTurnCredentials({ identity });

  return {
    ok: true,
    token,
    serverUrl: livekitPublicUrl(),
    identity,
    displayName,
    iceServers,
    meeting: { id: meeting.id, title: meeting.title, status: meeting.status },
  };
}

export async function endMeetingAction({
  meetingId,
}: {
  meetingId: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const me = await requireAuth();
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: {
      id: true,
      status: true,
      startedAt: true,
      livekitEgressId: true,
      createdById: true,
      channelId: true,
      project: { select: { ownerId: true, members: { select: { userId: true, role: true } } } },
    },
  });
  if (!meeting) return { ok: false, message: 'Встреча не найдена' };
  const allowed =
    me.role === 'ADMIN' ||
    meeting.createdById === me.id ||
    (meeting.project &&
      canManageAssignments({ id: me.id, role: me.role }, meeting.project));
  if (!allowed) return { ok: false, message: 'Нет прав' };

  if (meeting.livekitEgressId) {
    await stopEgress(meeting.livekitEgressId);
  }
  const endedAt = new Date();
  await prisma.meeting.update({
    where: { id: meeting.id },
    data: { status: 'ENDED', endedAt },
  });
  // If the call was started from a chat channel, drop a CALL_ENDED
  // system-message so participants see "Звонок завершён · 12:34"
  // right where it started. The transcribe-worker posts a richer
  // follow-up (summary + tasks) when the recording is ready.
  if (meeting.channelId) {
    const durationSec = meeting.startedAt
      ? Math.max(1, Math.round((endedAt.getTime() - meeting.startedAt.getTime()) / 1000))
      : null;
    const { publishChatEvent } = await import('@/lib/realtime/publishChat');
    try {
      const msg = await prisma.message.create({
        data: {
          channelId: meeting.channelId,
          authorId: me.id,
          body: '',
          source: 'SYSTEM',
          eventKind: 'CALL_ENDED',
          eventPayload: { meetingId: meeting.id, durationSec },
        },
        select: { id: true },
      });
      await prisma.channel.update({
        where: { id: meeting.channelId },
        data: { updatedAt: new Date() },
      });
      await publishChatEvent({
        kind: 'message.new',
        channelId: meeting.channelId,
        messageId: msg.id,
        authorId: me.id,
        parentId: null,
      });
    } catch (e) {
      // Don't fail the end-call action because we couldn't post the
      // system card — the meeting itself ended successfully.
      // eslint-disable-next-line no-console
      console.warn('[meetings] CALL_ENDED system message failed:', e);
    }
  }
  // Worker picks it up — but only after egress webhook fires
  // (egress_ended) the recording is fully flushed. Our webhook handler
  // publishes to TRANSCRIBE_CHANNEL when that arrives.
  revalidatePath('/meetings');
  revalidatePath(`/meetings/${meeting.id}`);
  if (meeting.channelId) {
    revalidatePath(`/messages/${meeting.channelId}`);
  }
  return { ok: true };
}

/**
 * Attach a meeting to a project AFTER it has finished and re-run the
 * AI layer (summary + task proposals) on the existing transcript.
 *
 * Use case: PM created a meeting without a project (e.g. quick
 * standup), realised after the fact that those action items should
 * land in PROJECT_X, and wants the proposal cards to appear without
 * recording another meeting.
 *
 * The worker has a fast path: if a transcript already exists for the
 * meeting, it skips WhisperX entirely and only runs Vertex AI. So
 * this is cheap (~5s on Gemini Flash) and doesn't burn the P100.
 */
export async function attachProjectAndRerunAiAction({
  meetingId,
  projectKey,
}: {
  meetingId: string;
  projectKey: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const me = await requireAuth();
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: {
      id: true,
      status: true,
      createdById: true,
      projectId: true,
      transcript: { select: { meetingId: true } },
    },
  });
  if (!meeting) return { ok: false, message: 'Встреча не найдена' };
  // Only the creator or an ADMIN can re-route a finished meeting —
  // attaching it elsewhere can leak the transcript to a new audience.
  if (me.role !== 'ADMIN' && meeting.createdById !== me.id) {
    return { ok: false, message: 'Нет прав' };
  }
  if (!meeting.transcript) {
    return { ok: false, message: 'Сначала дождитесь транскрипта' };
  }

  const project = await prisma.project.findUnique({
    where: { key: projectKey },
    select: {
      id: true,
      ownerId: true,
      members: { select: { userId: true, role: true } },
    },
  });
  if (!project) return { ok: false, message: 'Проект не найден' };
  // The user must be able to manage that project — otherwise they
  // could dump a stranger's meeting into someone else's workspace.
  if (!canManageAssignments({ id: me.id, role: me.role }, project)) {
    return { ok: false, message: 'Нет прав на этот проект' };
  }

  await prisma.meeting.update({
    where: { id: meeting.id },
    data: {
      projectId: project.id,
      // Flip status back so the worker's "already READY, skipping"
      // guard doesn't short-circuit. The worker's transcript-reuse
      // branch keeps the WhisperX cost off the table.
      status: 'ENDED',
      processingError: null,
    },
  });
  await redis().publish(TRANSCRIBE_CHANNEL, JSON.stringify({ meetingId: meeting.id }));
  revalidatePath(`/meetings/${meeting.id}`);
  return { ok: true };
}

/**
 * Force-trigger transcription (e.g. if webhook missed). Re-publishes
 * the meeting id; worker is idempotent (status check).
 */
export async function retranscribeMeetingAction({
  meetingId,
}: {
  meetingId: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const me = await requireAuth();
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: {
      id: true,
      status: true,
      recordingKey: true,
      createdById: true,
      project: { select: { ownerId: true, members: { select: { userId: true, role: true } } } },
    },
  });
  if (!meeting) return { ok: false, message: 'Встреча не найдена' };
  if (!meeting.recordingKey) return { ok: false, message: 'Записи ещё нет' };
  const allowed =
    me.role === 'ADMIN' ||
    meeting.createdById === me.id ||
    (meeting.project &&
      canManageAssignments({ id: me.id, role: me.role }, meeting.project));
  if (!allowed) return { ok: false, message: 'Нет прав' };

  await prisma.meeting.update({
    where: { id: meeting.id },
    data: { status: 'ENDED', processingError: null },
  });
  await redis().publish(TRANSCRIBE_CHANNEL, JSON.stringify({ meetingId: meeting.id }));
  revalidatePath(`/meetings/${meeting.id}`);
  return { ok: true };
}
