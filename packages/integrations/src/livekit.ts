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

import {
  AccessToken,
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
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
  const layout = 'grid';
  const opts2: RoomCompositeOptions = {
    layout,
    audioOnly: false,
    videoOnly: false,
    customBaseUrl: '',
    encodingOptions: undefined,
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
