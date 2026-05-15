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

  // Fire-and-forget fan-out across 3 channels (web push + in-app + Bitrix
  // IM). Each is isolated so a single channel failure doesn't break the
  // call or the other channels. See lib/meetings/fanOutCallInvites for
  // the shared implementation — also used by startGroupCallAction below.
  void (async () => {
    const { fanOutCallInvites, recipientsFromChannel } = await import(
      '@/lib/meetings/fanOutCallInvites'
    );
    const recipients = await recipientsFromChannel(input.channelId, me.id);
    await fanOutCallInvites({
      meetingId: created.meetingId,
      title,
      callerName: me.name ?? null,
      channelId: input.channelId,
      recipients,
    });
  })();

  revalidatePath(`/messages/${input.channelId}`);
  revalidatePath('/meetings');
  return { ok: true, meetingId: created.meetingId };
}

/**
 * Start an ad-hoc group call from anywhere (the "+ Новый групповой
 * звонок" button on /meetings). No channel attachment — the meeting
 * stands alone. The caller picks a roster of invitees up-front; those
 * users get the standard three-channel ping and are recorded as
 * MeetingParticipant rows so joinMeetingAction can grant them access
 * even though they aren't in any project or channel together.
 *
 * Permission: any active authenticated user. Calling is a peer-level
 * action, not an admin one.
 */
export async function startGroupCallAction(input: {
  title: string;
  participantUserIds: string[];
}): Promise<
  | { ok: true; meetingId: string }
  | { ok: false; message: string }
> {
  const me = await requireAuth();
  const cleanTitle = input.title.trim().slice(0, 200);
  if (cleanTitle.length < 2) {
    return { ok: false, message: 'Название слишком короткое' };
  }
  const inviteeIds = Array.from(new Set(input.participantUserIds)).filter(
    (id) => id !== me.id,
  );
  if (inviteeIds.length === 0) {
    return { ok: false, message: 'Выберите хотя бы одного участника' };
  }
  // Cap to keep a runaway form from creating a 1000-row roster.
  if (inviteeIds.length > 50) {
    return { ok: false, message: 'Не больше 50 участников за раз' };
  }

  // Validate invitees exist and are active — silently dropping stale
  // ids is friendlier than failing the whole call.
  const validInvitees = await prisma.user.findMany({
    where: { id: { in: inviteeIds }, isActive: true },
    select: { id: true },
  });
  if (validInvitees.length === 0) {
    return { ok: false, message: 'Никто из приглашённых не найден' };
  }

  const created = await prisma.$transaction(async (tx) => {
    const meeting = await tx.meeting.create({
      data: {
        title: cleanTitle,
        kind: 'VIDEO_LIVEKIT',
        status: 'PLANNED',
        createdById: me.id,
      },
      select: { id: true },
    });
    const livekitRoomName = newRoomName(meeting.id);
    await tx.meeting.update({
      where: { id: meeting.id },
      data: { livekitRoomName },
    });
    // Pre-create the roster so joinMeetingAction can verify membership
    // without re-reading the original participantUserIds. Identity
    // placeholder ("invite:") is rewritten at join time with the real
    // LiveKit identity ("user:<id>:<nonce>").
    await tx.meetingParticipant.createMany({
      data: [
        // Include the caller so the dashboard for them lists this
        // meeting under "my meetings" right away.
        {
          meetingId: meeting.id,
          userId: me.id,
          livekitIdentity: `invite:${me.id}`,
          displayName: (me.name || me.email || 'PM').slice(0, 80),
        },
        ...validInvitees.map((u) => ({
          meetingId: meeting.id,
          userId: u.id,
          livekitIdentity: `invite:${u.id}`,
          displayName: '',
        })),
      ],
      skipDuplicates: true,
    });
    return { meetingId: meeting.id, livekitRoomName };
  });

  // Fan-out invites to the chosen roster (excluding the caller). No
  // channel context for ad-hoc calls so isMuted always false here.
  void (async () => {
    const { fanOutCallInvites, recipientsFromUserIds } = await import(
      '@/lib/meetings/fanOutCallInvites'
    );
    const recipients = await recipientsFromUserIds(
      validInvitees.map((u) => u.id),
      me.id,
    );
    await fanOutCallInvites({
      meetingId: created.meetingId,
      title: cleanTitle,
      callerName: me.name ?? null,
      channelId: null,
      recipients,
    });
  })();

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
  // Permissions: creator, project member, channel member, ad-hoc
  // roster member, or admin. Chat-originated meetings (channelId set)
  // inherit visibility from the channel; ad-hoc group calls grant
  // access via the MeetingParticipant roster pre-populated by
  // startGroupCallAction.
  let channelAllowed = false;
  if (meeting.channelId) {
    const { resolveChannelAccess } = await import('@/lib/messenger/access');
    const acc = await resolveChannelAccess(meeting.channelId, me.id);
    channelAllowed = !!acc?.canRead;
  }
  let invited = false;
  if (!channelAllowed && meeting.createdById !== me.id && me.role !== 'ADMIN') {
    const roster = await prisma.meetingParticipant.findFirst({
      where: { meetingId, userId: me.id },
      select: { id: true },
    });
    invited = !!roster;
  }
  const allowed =
    me.role === 'ADMIN' ||
    meeting.createdById === me.id ||
    channelAllowed ||
    invited ||
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

/**
 * Mint a shareable guest-invite link for a meeting. Only the meeting
 * creator (or an ADMIN) can issue one — we don't want any random
 * participant minting links and inviting outsiders on someone else's
 * call.
 *
 * Default TTL: 24 hours. Caller can override with `expiresInHours`
 * (cap 168 = 7 days). `maxUses` is optional — null means "anyone with
 * the link can claim a guest seat until expiry / revoke".
 */
export async function createMeetingInviteAction(input: {
  meetingId: string;
  expiresInHours?: number;
  maxUses?: number | null;
}): Promise<
  | { ok: true; token: string; url: string; expiresAt: string }
  | { ok: false; message: string }
> {
  const me = await requireAuth();
  const meeting = await prisma.meeting.findUnique({
    where: { id: input.meetingId },
    select: { id: true, createdById: true, status: true },
  });
  if (!meeting) return { ok: false, message: 'Встреча не найдена' };
  if (meeting.createdById !== me.id && me.role !== 'ADMIN') {
    return { ok: false, message: 'Ссылки выдаёт только создатель встречи' };
  }
  if (meeting.status === 'ENDED' || meeting.status === 'PROCESSING' || meeting.status === 'READY') {
    return { ok: false, message: 'Встреча уже завершилась' };
  }
  const hours = Math.min(Math.max(input.expiresInHours ?? 24, 1), 168);
  const expiresAt = new Date(Date.now() + hours * 3600_000);

  // 32 url-safe bytes ≈ 256 bits of entropy — enough to make guessing
  // hopeless and still short enough to share by hand.
  const { randomBytes } = await import('node:crypto');
  const token = randomBytes(32).toString('base64url');

  await prisma.meetingInvite.create({
    data: {
      meetingId: meeting.id,
      token,
      createdById: me.id,
      expiresAt,
      maxUses: input.maxUses ?? null,
    },
  });

  const base = process.env.PUBLIC_BASE_URL?.trim() || 'https://pm.since-b24-ru.ru';
  return {
    ok: true,
    token,
    url: `${base}/m/${token}`,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Public guest-join action: validates the invite token, increments
 * usedCount under a transaction, mints a guest LiveKit JWT, and
 * records a MeetingParticipant row with userId=null.
 *
 * No auth required — that's the whole point. The token IS the auth.
 *
 * Returns the same shape as joinMeetingAction so the room mount
 * component can be reused without branching.
 */
export async function joinMeetingAsGuestAction(input: {
  token: string;
  displayName: string;
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
  const displayName = input.displayName.trim().slice(0, 80);
  if (displayName.length < 2) {
    return { ok: false, message: 'Введите имя (минимум 2 символа)' };
  }

  const invite = await prisma.meetingInvite.findUnique({
    where: { token: input.token },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      maxUses: true,
      usedCount: true,
      meeting: {
        select: {
          id: true,
          title: true,
          status: true,
          livekitRoomName: true,
        },
      },
    },
  });
  if (!invite) return { ok: false, message: 'Ссылка недействительна' };
  if (invite.revokedAt) return { ok: false, message: 'Ссылка отозвана' };
  if (invite.expiresAt < new Date()) return { ok: false, message: 'Срок действия ссылки истёк' };
  if (invite.maxUses != null && invite.usedCount >= invite.maxUses) {
    return { ok: false, message: 'Лимит подключений по этой ссылке исчерпан' };
  }
  const meeting = invite.meeting;
  if (!meeting || !meeting.livekitRoomName) {
    return { ok: false, message: 'Встреча не найдена' };
  }
  if (
    meeting.status === 'ENDED' ||
    meeting.status === 'PROCESSING' ||
    meeting.status === 'READY'
  ) {
    return { ok: false, message: 'Встреча уже завершилась' };
  }

  // Atomic claim: increment usedCount only if we're still under
  // maxUses. The conditional prevents two guests racing in past the
  // cap.
  const { randomBytes } = await import('node:crypto');
  const claim = await prisma.meetingInvite.updateMany({
    where: {
      id: invite.id,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      ...(invite.maxUses != null
        ? { usedCount: { lt: invite.maxUses } }
        : {}),
    },
    data: { usedCount: { increment: 1 } },
  });
  if (claim.count === 0) {
    return { ok: false, message: 'Ссылка стала недоступна' };
  }

  const guestSuffix = randomBytes(6).toString('base64url');
  const identity = `guest:${guestSuffix}`;

  await prisma.meetingParticipant.create({
    data: {
      meetingId: meeting.id,
      userId: null,
      livekitIdentity: identity,
      displayName,
    },
  });

  const accessToken = await mintAccessToken({
    roomName: meeting.livekitRoomName,
    identity,
    displayName,
    canPublish: true,
  });
  const iceServers = buildTurnCredentials({ identity });

  return {
    ok: true,
    token: accessToken,
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

/**
 * Persist the manual SPEAKER_xx → person mapping that a PM/creator
 * sets via the speaker editor on the meeting page. Replaces the
 * whole map atomically — caller sends the full desired state, we
 * overwrite. Each entry can name a giper-pm user (userId set, so
 * we can later link the transcript to people for search) or carry
 * a free-form name (guest, ex-employee, etc).
 *
 * Permissions mirror retranscribeMeetingAction: ADMIN, creator, or
 * PM of the attached project.
 */
export async function setMeetingSpeakerMapAction(input: {
  meetingId: string;
  /** SPEAKER_00 → { userId, name }. Empty object clears the map. */
  map: Record<string, { userId?: string | null; name: string }>;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const me = await requireAuth();
  const meeting = await prisma.meeting.findUnique({
    where: { id: input.meetingId },
    select: {
      id: true,
      createdById: true,
      project: { select: { ownerId: true, members: { select: { userId: true, role: true } } } },
      transcript: { select: { id: true } },
    },
  });
  if (!meeting) return { ok: false, message: 'Встреча не найдена' };
  if (!meeting.transcript) {
    return { ok: false, message: 'Транскрипт ещё не готов' };
  }
  const allowed =
    me.role === 'ADMIN' ||
    meeting.createdById === me.id ||
    (meeting.project &&
      canManageAssignments({ id: me.id, role: me.role }, meeting.project));
  if (!allowed) return { ok: false, message: 'Нет прав' };

  // Sanitize: keep only valid SPEAKER_xx keys, trim names, cap length.
  const clean: Record<string, { userId: string | null; name: string }> = {};
  for (const [label, raw] of Object.entries(input.map ?? {})) {
    if (!/^SPEAKER_\d+$/.test(label)) continue;
    const name = String(raw?.name ?? '').trim().slice(0, 80);
    if (!name) continue;
    clean[label] = {
      userId: raw?.userId ? String(raw.userId).slice(0, 64) : null,
      name,
    };
  }

  await prisma.meetingTranscript.update({
    where: { id: meeting.transcript.id },
    data: { speakerMap: clean as unknown as object },
  });
  revalidatePath(`/meetings/${meeting.id}`);
  return { ok: true };
}
