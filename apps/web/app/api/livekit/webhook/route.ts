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
// LiveKit can serialize EgressStatus as either the protobuf string
// ("EGRESS_COMPLETE") or its numeric enum value depending on the
// webhook serializer version. We accept both.
// `duration` is reported in NANOSECONDS as a 64-bit integer — current
// SDK versions serialize that as a JS BigInt, which throws on
// Math.round(). Accept number | bigint | string and normalize below.
type LkEgressInfo = {
  egress_id?: string;
  egressId?: string;
  status?: string | number;
  file?: { filename?: string; duration?: number | bigint | string };
  file_results?: { filename?: string; duration?: number | bigint | string }[];
  fileResults?: { filename?: string; duration?: number | bigint | string }[];
};

/**
 * Egress reports duration in nanoseconds. SDK ≥ 2 serializes 64-bit
 * fields as JS BigInt; pre-2 serializes them as plain numbers. We
 * accept either and return whole seconds (rounded).
 */
function durationNsToSeconds(
  raw: number | bigint | string | null | undefined,
): number | null {
  if (raw == null) return null;
  let nanos: number;
  if (typeof raw === 'bigint') {
    // bigint nanos / 1e9 fits in a double up to ~104 days; fine for meetings.
    nanos = Number(raw);
  } else if (typeof raw === 'string') {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return null;
    nanos = parsed;
  } else {
    nanos = raw;
  }
  if (!Number.isFinite(nanos) || nanos <= 0) return null;
  return Math.round(nanos / 1_000_000_000);
}

const EGRESS_STATUS_BY_NUM: Record<number, string> = {
  0: 'EGRESS_STARTING',
  1: 'EGRESS_ACTIVE',
  2: 'EGRESS_ENDING',
  3: 'EGRESS_COMPLETE',
  4: 'EGRESS_FAILED',
  5: 'EGRESS_ABORTED',
  6: 'EGRESS_LIMIT_REACHED',
};

function normalizeEgressStatus(s: string | number | undefined | null): string {
  if (s == null) return '';
  if (typeof s === 'number') return EGRESS_STATUS_BY_NUM[s] || `EGRESS_${s}`;
  return String(s).toUpperCase();
}
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
        // Identity shape: "user:<userId>" or "user:<userId>:<nonce>".
        // joinMeetingAction adds a per-session nonce so two renders of
        // the meeting page don't collide on identity (which would kick
        // the older socket). Strip everything after the second ':' to
        // recover the userId for participant attribution.
        const userId = ident.startsWith('user:')
          ? ident.slice(5).split(':')[0] || null
          : null;
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
      // terminal status (COMPLETE / FAILED). LiveKit does not include
      // the `room` field on egress events — we must locate the Meeting
      // via the egress id we previously persisted on participant_joined.
      try {
        const eg = pickEgress(ev);
        const status = normalizeEgressStatus(eg?.status);
        const isTerminal =
          status.includes('COMPLETE') ||
          status.includes('FAILED') ||
          status.includes('ENDED') ||
          status.includes('ABORTED') ||
          status.includes('LIMIT_REACHED');
        if (!isTerminal) break;

        const egressId = eg?.egress_id || eg?.egressId || null;
        let m: Awaited<ReturnType<typeof findMeeting>> = null;
        if (egressId) {
          m = await prisma.meeting.findFirst({
            where: { livekitEgressId: egressId },
            select: {
              id: true,
              status: true,
              recordingKey: true,
              livekitEgressId: true,
              livekitRoomName: true,
            },
          });
        }
        if (!m) m = await findMeeting(pickRoomName(ev));
        if (!m) {
          // eslint-disable-next-line no-console
          console.warn('[livekit-webhook] egress event without matching meeting', {
            egressId,
            room: pickRoomName(ev),
            status,
          });
          break;
        }

        const fileResult =
          eg?.file_results?.[0] || eg?.fileResults?.[0] || eg?.file || null;
        const recordingKey = fileResult?.filename || m.recordingKey;
        const durationSec = durationNsToSeconds(fileResult?.duration);

        // The filename LiveKit returns for S3 uploads can be either the
        // bare object key (what we want) or "s3://bucket/object". Strip
        // any bucket prefix so transcribe-worker can fetch directly.
        const cleanKey = (recordingKey || '').replace(/^s3:\/\/[^/]+\//, '');

        await prisma.meeting.update({
          where: { id: m.id },
          data: {
            recordingKey: cleanKey || recordingKey,
            ...(durationSec ? { recordingDurationSec: durationSec } : {}),
            status: status.includes('FAILED') ? 'FAILED' : 'PROCESSING',
            endedAt: new Date(),
            processingError: status.includes('FAILED') ? 'Egress failed' : null,
          },
        });

        if (!status.includes('FAILED')) {
          await redis().publish(TRANSCRIBE_CHANNEL, JSON.stringify({ meetingId: m.id }));
          // eslint-disable-next-line no-console
          console.log(`[livekit-webhook] published meeting:transcribe for ${m.id} key=${cleanKey}`);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[livekit-webhook] egress event handler crashed', e);
        // Don't 500 — LiveKit will retry forever and log noise.
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
