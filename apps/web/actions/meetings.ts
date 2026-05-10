'use server';

import { revalidatePath } from 'next/cache';
import { Redis } from 'ioredis';
import { prisma } from '@giper/db';
import {
  livekitPublicUrl,
  mintAccessToken,
  startCompositeEgress,
  stopEgress,
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
  | { ok: true; token: string; serverUrl: string; identity: string; displayName: string; meeting: { id: string; title: string; status: string } }
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

  const identity = `user:${me.id}`;
  const displayName = (me.name || me.email || 'PM').slice(0, 80);
  const token = await mintAccessToken({
    roomName: meeting.livekitRoomName,
    identity,
    displayName,
    canPublish: true,
  });

  // First successful join → start composite recording (idempotent: skip
  // if egressId already set). Webhook 'room_started' would also work
  // but it doesn't fire until LiveKit actually sees the first track.
  if (!meeting.livekitEgressId && meeting.status === 'PLANNED') {
    try {
      const { egressId, recordingKey } = await startCompositeEgress({
        roomName: meeting.livekitRoomName,
        meetingId: meeting.id,
      });
      await prisma.meeting.update({
        where: { id: meeting.id },
        data: {
          status: 'ACTIVE',
          startedAt: new Date(),
          livekitEgressId: egressId,
          recordingKey,
        },
      });
    } catch (e) {
      // Recording failure shouldn't block joining; log and continue.
      // eslint-disable-next-line no-console
      console.warn('[meetings] startCompositeEgress failed', e);
      await prisma.meeting.update({
        where: { id: meeting.id },
        data: { status: 'ACTIVE', startedAt: new Date() },
      });
    }
  }

  return {
    ok: true,
    token,
    serverUrl: livekitPublicUrl(),
    identity,
    displayName,
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
