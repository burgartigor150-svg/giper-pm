import { NextResponse } from 'next/server';
import { Redis } from 'ioredis';
import { prisma } from '@giper/db';
import { startCompositeEgress, verifyWebhook } from '@giper/integrations';

/**
 * LiveKit OSS posts events here whenever something interesting happens
 * in a room: participant joined/left, room finished, egress
 * started/ended. We use them to keep `Meeting`, `MeetingParticipant`,
 * and `recordingKey` in sync without needing the browser to ack.
 *
 * Configured in the `livekit` compose service via:
 *   webhook.api_key = LIVEKIT_API_KEY
 *   webhook.urls    = ${PUBLIC_BASE_URL}/api/livekit/webhook
 *
 * LiveKit signs the body with a JWT in `Authorization: Bearer <token>`.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

let _redis: Redis | null = null;
function redis(): Redis {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');
  _redis = new Redis(url);
  return _redis;
}

const TRANSCRIBE_CHANNEL = 'meeting:transcribe';

type LkRoom = { name?: string; sid?: string };
type LkParticipant = { identity?: string; name?: string };
type LkEgressInfo = {
  egress_id?: string;
  egressId?: string;
  status?: string;
  file?: { filename?: string; duration?: number };
  file_results?: { filename?: string; duration?: number }[];
  fileResults?: { filename?: string; duration?: number }[];
};
type LkEvent = {
  event?: string;
  room?: LkRoom;
  participant?: LkParticipant;
  egress_info?: LkEgressInfo;
  egressInfo?: LkEgressInfo;
};

function pickEgress(e: LkEvent): LkEgressInfo | null {
  return e.egress_info || e.egressInfo || null;
}
function pickRoomName(e: LkEvent): string | null {
  return e.room?.name || null;
}

async function findMeeting(roomName: string | null) {
  if (!roomName) return null;
  return prisma.meeting.findUnique({
    where: { livekitRoomName: roomName },
    select: {
      id: true,
      status: true,
      recordingKey: true,
      livekitEgressId: true,
      livekitRoomName: true,
    },
  });
}

/**
 * Bounded retry for startCompositeEgress — first call may race with
 * LiveKit's internal room-create + first-track-published events. We
 * try up to 4 times with backoff (instant, 1s, 3s, 6s).
 */
async function startEgressWithRetry(
  meetingId: string,
  roomName: string,
): Promise<{ ok: true; egressId: string; recordingKey: string } | { ok: false; error: string }> {
  const delays = [0, 1000, 3000, 6000];
  let lastErr: unknown = null;
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
    try {
      const res = await startCompositeEgress({ roomName, meetingId });
      return { ok: true, ...res };
    } catch (e) {
      lastErr = e;
      // eslint-disable-next-line no-console
      console.warn(
        `[livekit-webhook] startCompositeEgress attempt ${i + 1}/${delays.length} failed:`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }
  return {
    ok: false,
    error: lastErr instanceof Error ? lastErr.message : 'startEgress failed',
  };
}

export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  const raw = await req.text();
  const verified = await verifyWebhook(auth, raw);
  if (!verified.ok) {
    return NextResponse.json({ ok: false, error: verified.reason }, { status: 401 });
  }
  const ev = verified.event as unknown as LkEvent;
  const eventType = (ev.event || '').toLowerCase();
  // eslint-disable-next-line no-console
  console.log('[livekit-webhook]', eventType, pickRoomName(ev) ?? '<no-room>');

  switch (eventType) {
    case 'room_started': {
      const m = await findMeeting(pickRoomName(ev));
      if (m && m.status !== 'ACTIVE') {
        await prisma.meeting.update({
          where: { id: m.id },
          data: { status: 'ACTIVE', startedAt: new Date() },
        });
      }
      break;
    }
    case 'room_finished': {
      const m = await findMeeting(pickRoomName(ev));
      if (m && (m.status === 'ACTIVE' || m.status === 'PLANNED')) {
        await prisma.meeting.update({
          where: { id: m.id },
          data: { status: 'ENDED', endedAt: new Date() },
        });
      }
      break;
    }
    case 'participant_joined': {
      const m = await findMeeting(pickRoomName(ev));
      const ident = ev.participant?.identity;
      const name = ev.participant?.name || ident || 'guest';
      if (m && ident) {
        // Best-effort: link to a giper-pm user if identity follows our
        // "user:<id>" convention. Otherwise it's a guest row.
        const userId = ident.startsWith('user:') ? ident.slice(5) : null;
        try {
          await prisma.meetingParticipant.upsert({
            where: {
              meetingId_livekitIdentity: { meetingId: m.id, livekitIdentity: ident },
            },
            create: {
              meetingId: m.id,
              userId,
              livekitIdentity: ident,
              displayName: name,
            },
            update: {
              userId,
              displayName: name,
              leftAt: null,
            },
          });
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[livekit-webhook] upsert participant failed', e);
        }

        // Mark meeting ACTIVE immediately so the room UI updates.
        if (m.status === 'PLANNED') {
          await prisma.meeting.update({
            where: { id: m.id },
            data: { status: 'ACTIVE', startedAt: new Date() },
          });
        }

        // First real participant → kick off composite recording. The
        // room is now guaranteed to exist on LiveKit (this very event
        // proves it). Run async + fire-and-forget so the webhook
        // returns 200 to LiveKit within the 10s budget; otherwise
        // LiveKit times out and retries the whole webhook → cascade.
        if (!m.livekitEgressId && m.livekitRoomName) {
          const room = m.livekitRoomName;
          const meetingId = m.id;
          // intentionally not awaited
          void (async () => {
            const egRes = await startEgressWithRetry(meetingId, room);
            if (egRes.ok) {
              await prisma.meeting.update({
                where: { id: meetingId },
                data: {
                  livekitEgressId: egRes.egressId,
                  recordingKey: egRes.recordingKey,
                  processingError: null,
                },
              });
              // eslint-disable-next-line no-console
              console.log(`[livekit-webhook] egress started for meeting ${meetingId}: ${egRes.egressId}`);
            } else {
              // eslint-disable-next-line no-console
              console.error(`[livekit-webhook] egress final fail for meeting ${meetingId}: ${egRes.error}`);
              await prisma.meeting.update({
                where: { id: meetingId },
                data: { processingError: `Egress failed to start: ${egRes.error}` },
              });
            }
          })().catch((e) => {
            // eslint-disable-next-line no-console
            console.error('[livekit-webhook] egress async wrapper crashed', e);
          });
        }
      }
      break;
    }
    case 'participant_left': {
      const m = await findMeeting(pickRoomName(ev));
      const ident = ev.participant?.identity;
      if (m && ident) {
        await prisma.meetingParticipant.updateMany({
          where: { meetingId: m.id, livekitIdentity: ident, leftAt: null },
          data: { leftAt: new Date() },
        });
      }
      break;
    }
    case 'egress_ended':
    case 'egress_updated': {
      // egress_updated fires multiple times; we only react to the
      // terminal status (COMPLETE / FAILED).
      const eg = pickEgress(ev);
      const status = (eg?.status || '').toUpperCase();
      const isTerminal = status.includes('COMPLETE') || status.includes('FAILED') || status.includes('ENDED');
      if (!isTerminal) break;
      const m = await findMeeting(pickRoomName(ev));
      if (!m) break;
      const fileResult =
        eg?.file_results?.[0] || eg?.fileResults?.[0] || eg?.file || null;
      const recordingKey = fileResult?.filename || m.recordingKey;
      const durationSec = fileResult?.duration ? Math.round(fileResult.duration) : null;
      await prisma.meeting.update({
        where: { id: m.id },
        data: {
          recordingKey,
          ...(durationSec ? { recordingDurationSec: durationSec } : {}),
          status: status.includes('FAILED') ? 'FAILED' : 'ENDED',
          endedAt: new Date(),
          processingError: status.includes('FAILED') ? 'Egress failed' : null,
        },
      });
      if (!status.includes('FAILED')) {
        await redis().publish(TRANSCRIBE_CHANNEL, JSON.stringify({ meetingId: m.id }));
      }
      break;
    }
    default:
      // We log + accept every event type so LiveKit doesn't retry
      // forever on events we don't care about yet (track_published etc).
      break;
  }

  return NextResponse.json({ ok: true });
}
