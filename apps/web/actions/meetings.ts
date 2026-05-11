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
  // Permissions: creator, or project member, or admin.
  const allowed =
    me.role === 'ADMIN' ||
    meeting.createdById === me.id ||
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
      livekitEgressId: true,
      createdById: true,
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
  await prisma.meeting.update({
    where: { id: meeting.id },
    data: { status: 'ENDED', endedAt: new Date() },
  });
  // Worker picks it up — but only after egress webhook fires
  // (egress_ended) the recording is fully flushed. Our webhook handler
  // publishes to TRANSCRIBE_CHANNEL when that arrives.
  revalidatePath('/meetings');
  revalidatePath(`/meetings/${meeting.id}`);
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
