/**
 * giper-pm transcribe + AI worker.
 *
 * Two channels in Redis pub/sub:
 *   meeting:transcribe    — { meetingId } — full LiveKit recording flow.
 *   tg:transcribe-voice   — { messageIds[] } — batch transcribe TG voice
 *                           messages so AiHarvest can use their text.
 *
 * Single-flight queue: WhisperX is GPU-bound and slow, we serialise
 * everything per-process. Multiple worker replicas would each pull
 * one job at a time (good enough for now).
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Redis } from 'ioredis';
import { prisma } from '@giper/db';
import { transcribeAudio, type TranscriptSegment } from '@giper/integrations';
import { decryptToken } from '@giper/shared/tgTokenCrypto';
import { tgFetch } from '@giper/shared/tgProxy';
import { downloadObject } from './storage';
import { proposeMeetingTasks, summarizeMeeting } from './summary';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const MEETING_CHANNEL = 'meeting:transcribe';
const TG_VOICE_CHANNEL = 'tg:transcribe-voice';
const MEETING_PROPOSAL_TTL_SEC = 24 * 60 * 60;

let busy = false;
const pending: { type: 'meeting' | 'tg'; payload: unknown }[] = [];

function enqueue(item: { type: 'meeting' | 'tg'; payload: unknown }): void {
  pending.push(item);
  void drain();
}

async function drain(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    while (pending.length) {
      const item = pending.shift()!;
      try {
        if (item.type === 'meeting') {
          await processMeeting(item.payload as { meetingId: string });
        } else if (item.type === 'tg') {
          await processTgVoice(item.payload as { messageIds: string[] });
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[transcribe-worker] job failed', e);
      }
    }
  } finally {
    busy = false;
  }
}

async function ffmpegToWav(input: Buffer, ext: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'tw-'));
  const inPath = join(dir, `in.${ext}`);
  const outPath = join(dir, 'out.wav');
  await writeFile(inPath, input);
  await new Promise<void>((resolve, reject) => {
    const p = spawn(
      'ffmpeg',
      ['-y', '-i', inPath, '-ac', '1', '-ar', '16000', '-vn', outPath],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let err = '';
    p.stderr.on('data', (c) => {
      err += c.toString();
    });
    p.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${err.slice(-300)}`));
    });
  });
  try {
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Distributed lock via Redis SETNX. With multiple worker replicas
 * subscribed to the same `meeting:transcribe` channel, every replica
 * receives the same message. Only the one that wins the lock proceeds;
 * the others log and return. Lock TTL is generous (90 min) to cover
 * 2h meetings on a slow GPU; ttl-fall-through means a crashed worker
 * lets another replica retry the same meeting.
 */
const MEETING_LOCK_TTL_SEC = 90 * 60;
async function acquireMeetingLock(meetingId: string): Promise<boolean> {
  const r = publishRedis();
  const res = await r.set(`lock:meeting:${meetingId}`, String(process.pid), 'EX', MEETING_LOCK_TTL_SEC, 'NX');
  return res === 'OK';
}
async function releaseMeetingLock(meetingId: string): Promise<void> {
  await publishRedis().del(`lock:meeting:${meetingId}`).catch(() => undefined);
}

async function processMeeting(payload: { meetingId: string }): Promise<void> {
  const meetingId = payload.meetingId;

  if (!(await acquireMeetingLock(meetingId))) {
    // eslint-disable-next-line no-console
    console.log(`[transcribe-worker] meeting ${meetingId} already locked by another replica, skipping`);
    return;
  }

  try {
    await processMeetingInner(meetingId);
  } finally {
    await releaseMeetingLock(meetingId);
  }
}

async function processMeetingInner(meetingId: string): Promise<void> {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: {
      id: true,
      status: true,
      recordingKey: true,
      startedAt: true,
      project: {
        select: {
          id: true,
          key: true,
          name: true,
          members: { select: { user: { select: { id: true, name: true } } } },
        },
      },
    },
  });
  if (!meeting) {
    // eslint-disable-next-line no-console
    console.warn(`[transcribe-worker] meeting ${meetingId} gone`);
    return;
  }
  if (meeting.status === 'READY') {
    // eslint-disable-next-line no-console
    console.log(`[transcribe-worker] meeting ${meetingId} already READY, skipping`);
    return;
  }
  if (!meeting.recordingKey) {
    // eslint-disable-next-line no-console
    console.warn(`[transcribe-worker] meeting ${meetingId} has no recordingKey, skipping`);
    return;
  }

  await prisma.meeting.update({
    where: { id: meetingId },
    data: { status: 'PROCESSING', processingError: null },
  });

  try {
    // 1. Download mp4 from MinIO.
    // eslint-disable-next-line no-console
    console.log(`[transcribe-worker] meeting=${meetingId} downloading ${meeting.recordingKey}`);
    const mp4 = await downloadObject(meeting.recordingKey);

    // 2. ffmpeg → 16kHz mono WAV (Whisper-friendly).
    const wav = await ffmpegToWav(mp4, 'mp4');
    // eslint-disable-next-line no-console
    console.log(`[transcribe-worker] meeting=${meetingId} wav size=${wav.length}b, calling whisperx`);

    // 3. WhisperX transcribe with diarization.
    const transcript = await transcribeAudio({
      audio: wav,
      fileName: `meeting-${meetingId}.wav`,
      language: 'ru',
    });
    const segments = transcript.segments;
    const fullText = segments.map((s) => s.text).join(' ').trim();
    // eslint-disable-next-line no-console
    console.log(`[transcribe-worker] meeting=${meetingId} got ${segments.length} segments`);

    // 4. Persist transcript first — even if AI fails, PM has the text.
    await prisma.meetingTranscript.upsert({
      where: { meetingId },
      create: {
        meetingId,
        fullText,
        segments: segments as unknown as object,
        language: transcript.language,
        model: process.env.WHISPER_MODEL || 'large-v3',
      },
      update: {
        fullText,
        segments: segments as unknown as object,
        language: transcript.language,
        model: process.env.WHISPER_MODEL || 'large-v3',
        summary: null,
      },
    });

    // 5. AI summary + tasks (best-effort).
    const project = meeting.project
      ? {
          key: meeting.project.key,
          name: meeting.project.name,
          members: meeting.project.members.map((m) => ({
            id: m.user.id,
            name: m.user.name,
          })),
        }
      : null;

    let summary = '';
    try {
      summary = await summarizeMeeting(segments);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[transcribe-worker] summary failed`, e);
    }
    if (summary) {
      await prisma.meetingTranscript.update({
        where: { meetingId },
        data: { summary },
      });
    }

    // 6. Cache task proposals in Redis (UI fetches via action).
    if (project) {
      try {
        const proposals = await proposeMeetingTasks(segments, project, meeting.startedAt ?? new Date());
        const stored = proposals.map((p) => ({
          ...p,
          proposalId: `p_${Math.random().toString(36).slice(2, 10)}`,
        }));
        const bundle = {
          proposals: stored,
          projectKey: meeting.project!.key,
          generatedAt: Date.now(),
          messageIndex: {} as Record<string, unknown>,
        };
        await publishRedis().set(
          `ai:meeting:${meetingId}`,
          JSON.stringify(bundle),
          'EX',
          MEETING_PROPOSAL_TTL_SEC,
        );
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[transcribe-worker] proposeMeetingTasks failed`, e);
      }
    }

    // 7. Mark ready.
    await prisma.meeting.update({
      where: { id: meetingId },
      data: { status: 'READY' },
    });
    // eslint-disable-next-line no-console
    console.log(`[transcribe-worker] meeting=${meetingId} READY`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // eslint-disable-next-line no-console
    console.error(`[transcribe-worker] meeting=${meetingId} FAILED`, e);
    await prisma.meeting.update({
      where: { id: meetingId },
      data: { status: 'FAILED', processingError: message.slice(0, 1000) },
    });
  }
}

type TgAttachment = {
  telegramFileId: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  transcript?: string;
};

async function downloadTelegramFile(
  encryptedToken: string,
  telegramFileId: string,
): Promise<{ buffer: Buffer; ext: string }> {
  const token = decryptToken(encryptedToken);
  // 1. getFile to learn the file_path.
  const meta = await tgFetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(telegramFileId)}`);
  if (!meta.ok) throw new Error(`getFile HTTP ${meta.status}`);
  const j = (await meta.json()) as { ok: boolean; result?: { file_path?: string } };
  if (!j.ok || !j.result?.file_path) throw new Error('getFile bad payload');
  // 2. download bytes.
  const fileRes = await tgFetch(`https://api.telegram.org/file/bot${token}/${j.result.file_path}`);
  if (!fileRes.ok) throw new Error(`Telegram CDN HTTP ${fileRes.status}`);
  const ab = await fileRes.arrayBuffer();
  // pick a sane extension from file_path
  const path = j.result.file_path;
  const ext = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1) : 'oga';
  return { buffer: Buffer.from(ab), ext };
}

async function processTgVoice(payload: { messageIds: string[] }): Promise<void> {
  if (!payload.messageIds?.length) return;
  // eslint-disable-next-line no-console
  console.log(`[transcribe-worker] tg-voice batch (${payload.messageIds.length})`);

  // Pull all messages with their owning bot's encrypted token.
  const rows = await prisma.telegramProjectMessage.findMany({
    where: { id: { in: payload.messageIds } },
    select: {
      id: true,
      attachments: true,
      link: { select: { bot: { select: { encryptedToken: true } } } },
    },
  });

  for (const row of rows) {
    const attachments = (Array.isArray(row.attachments) ? row.attachments : []) as TgAttachment[];
    if (!attachments.length) continue;
    const updated: TgAttachment[] = [];
    let textChunks: string[] = [];
    for (const a of attachments) {
      // Only voice / round-video / audio files; skip plain documents.
      const isVoice =
        a.mimeType?.includes('audio') ||
        a.mimeType?.includes('video') ||
        a.fileName.endsWith('.ogg') ||
        a.fileName.endsWith('.oga') ||
        a.fileName.endsWith('.mp4') ||
        a.fileName.startsWith('voice-') ||
        a.fileName.startsWith('audio-');
      if (!isVoice || a.transcript) {
        updated.push(a);
        continue;
      }
      try {
        const { buffer, ext } = await downloadTelegramFile(
          row.link.bot.encryptedToken,
          a.telegramFileId,
        );
        // Convert to wav so whisper handles unknown codecs uniformly.
        const wav = await ffmpegToWav(buffer, ext);
        const result = await transcribeAudio({
          audio: wav,
          fileName: a.fileName,
          language: 'ru',
        });
        const text = result.segments.map((s) => s.text).join(' ').trim();
        updated.push({ ...a, transcript: text });
        if (text) textChunks.push(text);
        // eslint-disable-next-line no-console
        console.log(`[transcribe-worker] voice ${row.id} → ${text.slice(0, 80)}`);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[transcribe-worker] voice ${row.id} failed`, e);
        updated.push(a);
      }
    }
    // Write back. If we got at least one transcript, also append it
    // into `text` so the AI prompt sees it without extra plumbing.
    const newText =
      textChunks.length > 0
        ? `[голос] ${textChunks.join(' / ')}`
        : null;
    await prisma.telegramProjectMessage.update({
      where: { id: row.id },
      data: {
        attachments: updated as unknown as object,
        ...(newText ? { text: newText } : {}),
      },
    });
  }
}

let _pubRedis: Redis | null = null;
function publishRedis(): Redis {
  if (_pubRedis) return _pubRedis;
  _pubRedis = new Redis(REDIS_URL);
  return _pubRedis;
}

(async () => {
  const subRedis = new Redis(REDIS_URL, { lazyConnect: true });
  await subRedis.connect();

  await subRedis.subscribe(MEETING_CHANNEL, TG_VOICE_CHANNEL);
  subRedis.on('message', (channel, raw) => {
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      // eslint-disable-next-line no-console
      console.warn(`[transcribe-worker] bad payload on ${channel}:`, raw.slice(0, 200));
      return;
    }
    if (channel === MEETING_CHANNEL) {
      enqueue({ type: 'meeting', payload });
    } else if (channel === TG_VOICE_CHANNEL) {
      enqueue({ type: 'tg', payload });
    }
  });

  // eslint-disable-next-line no-console
  console.log(`[transcribe-worker] subscribed to ${MEETING_CHANNEL} + ${TG_VOICE_CHANNEL}`);

  const shutdown = async (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`[transcribe-worker] ${signal}, shutting down`);
    await subRedis.quit().catch(() => undefined);
    await _pubRedis?.quit().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
})().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[transcribe-worker] fatal', err);
  process.exit(1);
});
