/**
 * LiveKit OSS server helpers — JWT minting + egress (recording) control.
 *
 * Used by:
 *  - apps/web `actions/meetings.ts` — mint per-participant tokens, kick
 *    off composite recording when the room starts.
 *  - apps/transcribe-worker — read recordingKey after egress finishes,
 *    download mp4 from MinIO.
 *
 * Required env (must match the `livekit` + `livekit-egress` services
 * in infra/docker-compose.prod.yml):
 *   LIVEKIT_API_KEY
 *   LIVEKIT_API_SECRET
 *   LIVEKIT_API_URL          — internal host URL, e.g. http://host.docker.internal:7880
 *   LIVEKIT_PUBLIC_URL       — public WSS URL, e.g. wss://pm.since-b24-ru.ru/livekit
 */

import { createHmac } from 'node:crypto';
import {
  AccessToken,
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
  EncodingOptionsPreset,
  RoomCompositeOptions,
  S3Upload,
} from 'livekit-server-sdk';

function env(name: string, required = true): string {
  const v = process.env[name]?.trim();
  if (!v && required) throw new Error(`${name} is not set`);
  return v ?? '';
}

function apiKey(): string {
  return env('LIVEKIT_API_KEY');
}
function apiSecret(): string {
  return env('LIVEKIT_API_SECRET');
}
function apiUrl(): string {
  return env('LIVEKIT_API_URL');
}

export function livekitPublicUrl(): string {
  return env('LIVEKIT_PUBLIC_URL');
}

/**
 * Mint a participant access token for a LiveKit room. TTL 4 hours
 * (`new AccessToken` default is 6 hours; we tighten it).
 */
export async function mintAccessToken(opts: {
  roomName: string;
  identity: string;
  displayName: string;
  /** false = subscriber-only (passive viewer); default true. */
  canPublish?: boolean;
  /** Override token TTL in seconds (default 4 h). */
  ttlSeconds?: number;
}): Promise<string> {
  const at = new AccessToken(apiKey(), apiSecret(), {
    identity: opts.identity,
    name: opts.displayName,
    ttl: opts.ttlSeconds ?? 4 * 60 * 60,
  });
  at.addGrant({
    room: opts.roomName,
    roomJoin: true,
    canPublish: opts.canPublish !== false,
    canSubscribe: true,
    canPublishData: true,
  });
  return at.toJwt();
}

/**
 * Kick off composite recording (the egress service joins the room as a
 * viewer, lays out the video tiles, encodes to mp4, streams to S3).
 *
 * Storage env (STORAGE_*) is read by the egress container itself; we
 * just point it at a key under `meetings/<id>/recording.mp4`.
 */
export async function startCompositeEgress(opts: {
  roomName: string;
  meetingId: string;
}): Promise<{ egressId: string; recordingKey: string }> {
  const egress = new EgressClient(apiUrl(), apiKey(), apiSecret());
  const recordingKey = `meetings/${opts.meetingId}/recording.mp4`;
  const fileOutput = new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: recordingKey,
    output: {
      case: 's3',
      value: new S3Upload({
        accessKey: env('STORAGE_ACCESS_KEY', false) || undefined,
        secret: env('STORAGE_SECRET_KEY', false) || undefined,
        region: env('STORAGE_REGION', false) || 'us-east-1',
        bucket: env('STORAGE_BUCKET', false) || 'attachments',
        endpoint: env('STORAGE_ENDPOINT', false) || undefined,
        forcePathStyle: env('STORAGE_FORCE_PATH_STYLE', false) === '1',
      }),
    },
  });
  // For 30-person meetings the default `grid` layout would render
  // 30 video tiles in headless Chrome → high CPU + tiny faces, often
  // dropping frames. `speaker` layout shows the active speaker large
  // + thumbnails of others, which scales gracefully and produces a
  // more useful recording. H264_720P_30 keeps file size manageable
  // (~1.5 GB/hour) while staying readable.
  const opts2: RoomCompositeOptions = {
    layout: 'speaker',
    audioOnly: false,
    videoOnly: false,
    customBaseUrl: '',
    encodingOptions: EncodingOptionsPreset.H264_720P_30,
  };
  const info = await egress.startRoomCompositeEgress(opts.roomName, { file: fileOutput }, opts2);
  return { egressId: info.egressId, recordingKey };
}

export async function stopEgress(egressId: string): Promise<void> {
  const egress = new EgressClient(apiUrl(), apiKey(), apiSecret());
  try {
    await egress.stopEgress(egressId);
  } catch (e) {
    // Egress may already be in a terminal state (auto-stopped when the
    // room emptied); swallow the "not active" error.
    // eslint-disable-next-line no-console
    console.warn('[livekit] stopEgress failed (already done?)', e);
  }
}

/**
 * Per-participant TURN credentials for coturn `use-auth-secret` mode
 * (long-term credential REST API: https://datatracker.ietf.org/doc/html/draft-uberti-behave-turn-rest-00).
 *
 * username = `<unix-timestamp>:<identity>` (TTL = 12 h)
 * password = base64(HMAC-SHA1(static-secret, username))
 *
 * The browser plugs these into RTCPeerConnection.iceServers — coturn
 * authenticates the request without a per-user database. Returns null
 * when env vars are not set so callers can keep working with STUN-only.
 *
 * Env (host /opt/giper-pm/.env):
 *   TURN_REST_SECRET   — must match coturn's `static-auth-secret`
 *   TURN_HOST          — public hostname/IP of coturn (e.g. 81.29.141.119)
 *   TURN_REALM         — coturn's `realm` (informational only)
 *   TURN_TLS_PORT      — TLS port (default 5349)
 *   TURN_UDP_PORT      — UDP/TCP port (default 3478)
 */
export type IceServer = {
  urls: string[];
  username?: string;
  credential?: string;
};

export function buildTurnCredentials(opts: {
  identity: string;
  ttlSeconds?: number;
}): IceServer[] {
  const secret = process.env.TURN_REST_SECRET?.trim();
  const host = process.env.TURN_HOST?.trim();
  if (!secret || !host) {
    // No TURN configured — return STUN-only (better than nothing for
    // typical NAT, won't help symmetric NAT but won't break anything).
    return [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    ];
  }
  const ttl = opts.ttlSeconds ?? 12 * 60 * 60;
  const expiry = Math.floor(Date.now() / 1000) + ttl;
  const username = `${expiry}:${opts.identity}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');

  const udpPort = process.env.TURN_UDP_PORT?.trim() || '3478';
  const tlsPort = process.env.TURN_TLS_PORT?.trim() || '5349';

  // Order matters: clients try the first URL first. We prioritise
  // UDP (lowest latency), then TCP fallback, then TLS-on-443-style
  // fallback for restrictive corporate firewalls.
  const urls: string[] = [
    `turn:${host}:${udpPort}?transport=udp`,
    `turn:${host}:${udpPort}?transport=tcp`,
    `turns:${host}:${tlsPort}?transport=tcp`,
    // Bonus STUN entries — same coturn host serves STUN on the same port.
    `stun:${host}:${udpPort}`,
  ];
  return [{ urls, username, credential }];
}

/**
 * LiveKit signs webhooks with a JWT in the Authorization header. We
 * verify it matches our API key/secret pair before trusting the body.
 */
export async function verifyWebhook(
  authorization: string | null,
  bodyText: string,
): Promise<{ ok: true; event: Record<string, unknown> } | { ok: false; reason: string }> {
  if (!authorization) return { ok: false, reason: 'missing Authorization header' };
  try {
    // livekit-server-sdk exposes WebhookReceiver, but we keep the
    // import surface narrow — it's a thin JWT verify.
    const { WebhookReceiver } = await import('livekit-server-sdk');
    const receiver = new WebhookReceiver(apiKey(), apiSecret());
    const event = await receiver.receive(bodyText, authorization);
    return { ok: true, event: event as unknown as Record<string, unknown> };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : 'verify failed',
    };
  }
}
