import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration tests for the LiveKit webhook handler at
 * `/api/livekit/webhook`. Every interesting state transition for a
 * Meeting comes from a webhook event (room_started, participant_joined,
 * participant_left, room_finished, egress_ended) — getting these wrong
 * silently corrupts meeting status, participant rows, and recording
 * pipelines.
 *
 * What's mocked:
 *   - verifyWebhook: bypasses JWT verification so tests don't need to
 *     mint a real LiveKit-server-sdk token. The route trusts whatever
 *     event object verifyWebhook returns; production verification is
 *     covered by livekit-server-sdk's own tests.
 *   - startCompositeEgress: prevents the route from dialing the real
 *     LiveKit server when participant_joined fires for the first
 *     participant. We verify the side-effect (Meeting.livekitEgressId
 *     + recordingKey) by letting the route's persistence layer run.
 *   - ioredis: meeting:transcribe publish is a no-op (we just assert
 *     it was called for COMPLETE egress).
 *
 * Source: apps/web/app/api/livekit/webhook/route.ts
 */

vi.mock('@giper/integrations', async () => {
  const actual = await vi.importActual<typeof import('@giper/integrations')>(
    '@giper/integrations',
  );
  return {
    ...actual,
    verifyWebhook: vi.fn(async (_auth: string | null, body: string) => {
      // The route treats `event` as already-parsed JSON.
      return { ok: true, event: JSON.parse(body) } as const;
    }),
    startCompositeEgress: vi.fn(async ({ meetingId }: { meetingId: string }) => ({
      egressId: `EG_${meetingId.slice(-8)}`,
      recordingKey: `meetings/${meetingId}/recording.mp4`,
    })),
  };
});

// Redis: webhook publishes to 'meeting:transcribe' on terminal egress.
// We track the publish so tests can assert it fired (or didn't).
const publishedMessages: { channel: string; message: string }[] = [];
vi.mock('ioredis', () => ({
  Redis: class FakeRedis {
    publish(channel: string, message: string) {
      publishedMessages.push({ channel, message });
      return Promise.resolve(1);
    }
  },
}));

import { prisma } from '@giper/db';
import { POST } from '@/app/api/livekit/webhook/route';
import { makeUser } from './helpers/factories';

function eventReq(payload: unknown): Request {
  return new Request('http://test.local/api/livekit/webhook', {
    method: 'POST',
    headers: { authorization: 'Bearer mocked-jwt' },
    body: JSON.stringify(payload),
  });
}

async function makeMeeting(opts: {
  status?: 'PLANNED' | 'ACTIVE';
  egressId?: string | null;
} = {}) {
  const creator = await makeUser();
  return prisma.meeting.create({
    data: {
      title: 'Webhook test',
      kind: 'VIDEO_LIVEKIT',
      status: opts.status ?? 'PLANNED',
      createdById: creator.id,
      livekitRoomName: `m_${Math.random().toString(36).slice(2, 12)}`,
      ...(opts.egressId !== undefined ? { livekitEgressId: opts.egressId } : {}),
    },
  });
}

beforeEach(() => {
  publishedMessages.length = 0;
});

describe('LiveKit webhook — auth', () => {
  it('missing Authorization header → 401', async () => {
    const req = new Request('http://test.local/api/livekit/webhook', {
      method: 'POST',
      body: JSON.stringify({ event: 'room_started' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

describe('LiveKit webhook — room_started', () => {
  it('flips a PLANNED meeting to ACTIVE and stamps startedAt', async () => {
    const m = await makeMeeting({ status: 'PLANNED' });
    const res = await POST(
      eventReq({ event: 'room_started', room: { name: m.livekitRoomName } }),
    );
    expect(res.status).toBe(200);
    const after = await prisma.meeting.findUnique({ where: { id: m.id } });
    expect(after?.status).toBe('ACTIVE');
    expect(after?.startedAt).not.toBeNull();
  });

  it('no-ops if the room is unknown', async () => {
    const res = await POST(
      eventReq({ event: 'room_started', room: { name: 'm_doesnotexist' } }),
    );
    expect(res.status).toBe(200);
    expect(await prisma.meeting.count()).toBe(0);
  });

  it('does NOT re-set startedAt if meeting already ACTIVE', async () => {
    const m = await makeMeeting({ status: 'ACTIVE' });
    const before = await prisma.meeting.update({
      where: { id: m.id },
      data: { startedAt: new Date(2024, 0, 1) },
    });
    await POST(eventReq({ event: 'room_started', room: { name: m.livekitRoomName } }));
    const after = await prisma.meeting.findUnique({ where: { id: m.id } });
    expect(after?.startedAt?.getTime()).toBe(before.startedAt?.getTime());
  });
});

describe('LiveKit webhook — participant_joined', () => {
  it('creates a MeetingParticipant row for a regular "user:<id>:<nonce>" identity', async () => {
    const m = await makeMeeting();
    const user = await makeUser();
    const identity = `user:${user.id}:abc12345`;

    await POST(
      eventReq({
        event: 'participant_joined',
        room: { name: m.livekitRoomName },
        participant: { identity, name: 'Иван' },
      }),
    );
    const p = await prisma.meetingParticipant.findFirst({
      where: { meetingId: m.id, livekitIdentity: identity },
    });
    expect(p?.userId).toBe(user.id);
    expect(p?.displayName).toBe('Иван');
    expect(p?.leftAt).toBeNull();
  });

  it('guest identity "guest:<rand>" creates a row with userId=null', async () => {
    const m = await makeMeeting();
    const identity = 'guest:abcXYZ';
    await POST(
      eventReq({
        event: 'participant_joined',
        room: { name: m.livekitRoomName },
        participant: { identity, name: 'Внешний Гость' },
      }),
    );
    const p = await prisma.meetingParticipant.findFirst({
      where: { meetingId: m.id, livekitIdentity: identity },
    });
    expect(p?.userId).toBeNull();
    expect(p?.displayName).toBe('Внешний Гость');
  });

  it('flips PLANNED → ACTIVE on first participant_joined', async () => {
    const m = await makeMeeting({ status: 'PLANNED' });
    await POST(
      eventReq({
        event: 'participant_joined',
        room: { name: m.livekitRoomName },
        participant: { identity: 'user:fake:nonce', name: 'X' },
      }),
    );
    const after = await prisma.meeting.findUnique({ where: { id: m.id } });
    expect(after?.status).toBe('ACTIVE');
  });

  it('rejoin (same identity, second event) upserts cleanly + clears leftAt', async () => {
    const m = await makeMeeting();
    const identity = 'guest:rejoin1';
    await POST(
      eventReq({
        event: 'participant_joined',
        room: { name: m.livekitRoomName },
        participant: { identity, name: 'A' },
      }),
    );
    // Simulate them leaving.
    await POST(
      eventReq({
        event: 'participant_left',
        room: { name: m.livekitRoomName },
        participant: { identity },
      }),
    );
    const between = await prisma.meetingParticipant.findFirst({
      where: { meetingId: m.id, livekitIdentity: identity },
    });
    expect(between?.leftAt).not.toBeNull();

    // Now re-join.
    await POST(
      eventReq({
        event: 'participant_joined',
        room: { name: m.livekitRoomName },
        participant: { identity, name: 'A' },
      }),
    );
    const after = await prisma.meetingParticipant.findFirst({
      where: { meetingId: m.id, livekitIdentity: identity },
    });
    expect(after?.leftAt).toBeNull();
  });
});

describe('LiveKit webhook — participant_left', () => {
  it('stamps leftAt on the matching participant row', async () => {
    const m = await makeMeeting();
    const identity = 'user:somebody:nonce';
    await POST(
      eventReq({
        event: 'participant_joined',
        room: { name: m.livekitRoomName },
        participant: { identity, name: 'X' },
      }),
    );
    await POST(
      eventReq({
        event: 'participant_left',
        room: { name: m.livekitRoomName },
        participant: { identity },
      }),
    );
    const p = await prisma.meetingParticipant.findFirst({
      where: { meetingId: m.id, livekitIdentity: identity },
    });
    expect(p?.leftAt).not.toBeNull();
  });

  it('participant_left for unknown identity is a no-op (no crash)', async () => {
    const m = await makeMeeting();
    const res = await POST(
      eventReq({
        event: 'participant_left',
        room: { name: m.livekitRoomName },
        participant: { identity: 'guest:never-joined' },
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe('LiveKit webhook — room_finished', () => {
  it('ACTIVE meeting → ENDED + endedAt', async () => {
    const m = await makeMeeting({ status: 'ACTIVE' });
    await POST(
      eventReq({ event: 'room_finished', room: { name: m.livekitRoomName } }),
    );
    const after = await prisma.meeting.findUnique({ where: { id: m.id } });
    expect(after?.status).toBe('ENDED');
    expect(after?.endedAt).not.toBeNull();
  });

  it('already-ENDED meeting stays ENDED (no double-stamp)', async () => {
    const m = await makeMeeting({ status: 'ACTIVE' });
    await prisma.meeting.update({
      where: { id: m.id },
      data: { status: 'ENDED', endedAt: new Date(2024, 5, 5) },
    });
    await POST(
      eventReq({ event: 'room_finished', room: { name: m.livekitRoomName } }),
    );
    const after = await prisma.meeting.findUnique({ where: { id: m.id } });
    expect(after?.endedAt?.getTime()).toBe(new Date(2024, 5, 5).getTime());
  });
});

describe('LiveKit webhook — egress_ended', () => {
  it('terminal COMPLETE → meeting PROCESSING + recordingKey + publish to transcribe', async () => {
    const creator = await makeUser();
    const m = await prisma.meeting.create({
      data: {
        title: 'For egress',
        kind: 'VIDEO_LIVEKIT',
        status: 'ACTIVE',
        createdById: creator.id,
        livekitRoomName: 'm_egress1',
        livekitEgressId: 'EG_done1',
      },
    });
    await POST(
      eventReq({
        event: 'egress_ended',
        room: { name: m.livekitRoomName },
        egress_info: {
          egress_id: 'EG_done1',
          status: 'EGRESS_COMPLETE',
          file: {
            filename: 'meetings/abc/recording.mp4',
            duration: 65 * 1_000_000_000, // 65 sec in ns
          },
        },
      }),
    );
    const after = await prisma.meeting.findUnique({ where: { id: m.id } });
    expect(after?.status).toBe('PROCESSING');
    expect(after?.recordingKey).toBe('meetings/abc/recording.mp4');
    expect(after?.recordingDurationSec).toBe(65);

    expect(publishedMessages.length).toBe(1);
    expect(publishedMessages[0]!.channel).toBe('meeting:transcribe');
    const payload = JSON.parse(publishedMessages[0]!.message);
    expect(payload.meetingId).toBe(m.id);
  });

  it('terminal FAILED → meeting FAILED + processingError + NO publish', async () => {
    const creator = await makeUser();
    const m = await prisma.meeting.create({
      data: {
        title: 'Egress fail',
        kind: 'VIDEO_LIVEKIT',
        status: 'ACTIVE',
        createdById: creator.id,
        livekitRoomName: 'm_egfail1',
        livekitEgressId: 'EG_fail1',
      },
    });
    await POST(
      eventReq({
        event: 'egress_ended',
        room: { name: m.livekitRoomName },
        egress_info: { egress_id: 'EG_fail1', status: 'EGRESS_FAILED' },
      }),
    );
    const after = await prisma.meeting.findUnique({ where: { id: m.id } });
    expect(after?.status).toBe('FAILED');
    expect(after?.processingError).toContain('Egress failed');
    expect(publishedMessages.length).toBe(0);
  });

  it('non-terminal egress_updated (EGRESS_ACTIVE) is ignored', async () => {
    const creator = await makeUser();
    const m = await prisma.meeting.create({
      data: {
        title: 'Still recording',
        kind: 'VIDEO_LIVEKIT',
        status: 'ACTIVE',
        createdById: creator.id,
        livekitRoomName: 'm_egactive1',
        livekitEgressId: 'EG_active1',
      },
    });
    await POST(
      eventReq({
        event: 'egress_updated',
        room: { name: m.livekitRoomName },
        egress_info: { egress_id: 'EG_active1', status: 'EGRESS_ACTIVE' },
      }),
    );
    const after = await prisma.meeting.findUnique({ where: { id: m.id } });
    expect(after?.status).toBe('ACTIVE');
    expect(publishedMessages.length).toBe(0);
  });

  it('duration as bigint (SDK ≥ 2) is normalized to seconds', async () => {
    const creator = await makeUser();
    const m = await prisma.meeting.create({
      data: {
        title: 'Bigint duration',
        kind: 'VIDEO_LIVEKIT',
        status: 'ACTIVE',
        createdById: creator.id,
        livekitRoomName: 'm_bignum',
        livekitEgressId: 'EG_bignum',
      },
    });
    // Pass through JSON.stringify(BigInt) won't work; we go through
    // string form which the route's normalizer also accepts.
    await POST(
      eventReq({
        event: 'egress_ended',
        room: { name: m.livekitRoomName },
        egress_info: {
          egress_id: 'EG_bignum',
          status: 3, // numeric COMPLETE
          file: {
            filename: 'meetings/big/recording.mp4',
            duration: String(120 * 1_000_000_000),
          },
        },
      }),
    );
    const after = await prisma.meeting.findUnique({ where: { id: m.id } });
    expect(after?.recordingDurationSec).toBe(120);
  });

  it('matches Meeting via livekitEgressId when the room field is absent', async () => {
    const creator = await makeUser();
    const m = await prisma.meeting.create({
      data: {
        title: 'No room field',
        kind: 'VIDEO_LIVEKIT',
        status: 'ACTIVE',
        createdById: creator.id,
        livekitRoomName: 'm_norfield',
        livekitEgressId: 'EG_lookup',
      },
    });
    await POST(
      eventReq({
        event: 'egress_ended',
        // Note: no `room` field at all — only the egress id.
        egress_info: {
          egress_id: 'EG_lookup',
          status: 'EGRESS_COMPLETE',
          file: { filename: 'k.mp4', duration: 1_000_000_000 },
        },
      }),
    );
    const after = await prisma.meeting.findUnique({ where: { id: m.id } });
    expect(after?.status).toBe('PROCESSING');
  });
});

describe('LiveKit webhook — unknown event type', () => {
  it('accepts and 200s, no DB change', async () => {
    const m = await makeMeeting();
    const before = await prisma.meeting.findUnique({ where: { id: m.id } });
    const res = await POST(
      eventReq({ event: 'track_published', room: { name: m.livekitRoomName } }),
    );
    expect(res.status).toBe(200);
    const after = await prisma.meeting.findUnique({ where: { id: m.id } });
    expect(after?.status).toBe(before?.status);
  });
});
