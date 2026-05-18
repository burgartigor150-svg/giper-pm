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
      // Preload transcript to enable AI-only rerun: when a meeting that
      // had no project gets one attached later, we skip the expensive
      // WhisperX leg and just regenerate summary + task proposals.
      transcript: {
        select: { fullText: true, segments: true, language: true },
      },
    },
  });
  if (!meeting) {
    // eslint-disable-next-line no-console
    console.warn(`[transcribe-worker] meeting ${meetingId} gone`);
    return;
  }
  // Distinguish a true "already done" run (status=READY, transcript
  // exists) from an "AI-rerun" intent — caller flips status back to
  // ENDED to indicate they want another pass at the AI layer only.
  if (meeting.status === 'READY') {
    // eslint-disable-next-line no-console
    console.log(`[transcribe-worker] meeting ${meetingId} already READY, skipping`);
    return;
  }
  const hasTranscript =
    !!meeting.transcript && Array.isArray(meeting.transcript.segments);
  if (!meeting.recordingKey && !hasTranscript) {
    // eslint-disable-next-line no-console
    console.warn(`[transcribe-worker] meeting ${meetingId} has no recordingKey, skipping`);
    return;
  }

  await prisma.meeting.update({
    where: { id: meetingId },
    data: { status: 'PROCESSING', processingError: null },
  });

  try {
    type Seg = { start: number; end: number; text: string; speaker?: string };
    let segments: Seg[];
    let fullText: string;
    let transcriptLanguage: string | null = null;

    if (hasTranscript) {
      // eslint-disable-next-line no-console
      console.log(`[transcribe-worker] meeting=${meetingId} reusing existing transcript (AI rerun)`);
      segments = meeting.transcript!.segments as unknown as Seg[];
      fullText = meeting.transcript!.fullText;
      transcriptLanguage = meeting.transcript!.language;
    } else {
      // 1. Download mp4 from MinIO.
      // eslint-disable-next-line no-console
      console.log(`[transcribe-worker] meeting=${meetingId} downloading ${meeting.recordingKey}`);
      const mp4 = await downloadObject(meeting.recordingKey!);

      // 2. ffmpeg → 16kHz mono WAV (Whisper-friendly).
      const wav = await ffmpegToWav(mp4, 'mp4');
      // eslint-disable-next-line no-console
      console.log(`[transcribe-worker] meeting=${meetingId} wav size=${wav.length}b, calling whisperx`);

      // 3. WhisperX transcribe with diarization. Hint the diarizer
      //    HARD on participant count: WhisperX/pyannote.audio
      //    aggressively over-splits — a 2-person call often ends up
      //    with SPEAKER_00..SPEAKER_03 because the same voice in a
      //    cough vs a long sentence has different embeddings. Loose
      //    bounds (±1) didn't help in prod; pinning min=max forces
      //    the diarizer to assign every segment to one of N labels.
      // Count only identities that could plausibly produce audio.
      // We have THREE kinds of MeetingParticipant rows:
      //   - "user:<uid>:<nonce>"  — a real LiveKit member session
      //   - "guest:<rand>"        — a real LiveKit guest session
      //   - "invite:<uid>"        — a roster placeholder written at
      //                             startGroupCallAction time, BEFORE
      //                             the user actually joined the room
      //   - "EG_*"                — the egress recorder bot
      // Only user:/guest: identities are real speakers; invite:* and
      // EG_* inflate the count. Observed in prod: a 2-person call
      // came back with 5 participant rows (2 invites + 1 real user +
      // 1 egress + 1 guest), so hard cap got set to 5 and WhisperX
      // happily over-split a 2-person dialogue into 5 voices.
      //
      // Also dedupe by userId/identity-prefix: a user who reconnects
      // creates a new row with a fresh nonce; counting both would
      // still over-cap.
      const allParts = await prisma.meetingParticipant.findMany({
        where: { meetingId },
        select: { livekitIdentity: true, userId: true },
      });
      const realIdentities = new Set<string>();
      for (const p of allParts) {
        const id = p.livekitIdentity || '';
        if (id.startsWith('user:')) {
          // Collapse "user:<uid>:<nonce>" → just userId so a reconnect
          // doesn't count as a second speaker.
          realIdentities.add(`user:${p.userId ?? id.split(':')[1]}`);
        } else if (id.startsWith('guest:')) {
          realIdentities.add(id);
        }
        // invite:* and EG_* are skipped entirely.
      }
      const participantCount = realIdentities.size;
      // Hard cap on both sides. participantCount=0 (legacy meetings
      // without proper participant rows) → leave hints unset, let
      // WhisperX pick freely. Otherwise force exactly N speakers.
      const hardCap = participantCount > 0 ? participantCount : null;
      // eslint-disable-next-line no-console
      console.log(
        `[transcribe-worker] meeting=${meetingId} diarize hard cap=${hardCap} ` +
          `(real speakers=${participantCount}, total rows=${allParts.length})`,
      );
      const transcript = await transcribeAudio({
        audio: wav,
        fileName: `meeting-${meetingId}.wav`,
        language: 'ru',
        minSpeakers: hardCap,
        maxSpeakers: hardCap,
      });
      // Belt-and-braces post-process: WhisperX sometimes ignores our
      // bounds (the parameter forwarding through whisper-asr-webservice
      // → pyannote is finicky and silently drops bad shapes). If the
      // result still has > hardCap distinct labels, merge the extras
      // into existing ones by closest-time-anchored mapping: every
      // overflow SPEAKER_xx → the SPEAKER_yy whose surrounding
      // segments are closest in time. This trades a small amount of
      // accuracy for a stable speaker count that the SpeakerEditor UI
      // can actually handle.
      segments = capDiarizationLabels(transcript.segments, hardCap);
      fullText = segments.map((s) => s.text).join(' ').trim();
      transcriptLanguage = transcript.language;
      // eslint-disable-next-line no-console
      console.log(
        `[transcribe-worker] meeting=${meetingId} got ${segments.length} segments, ` +
          `${new Set(segments.map((s) => s.speaker).filter(Boolean)).size} distinct speakers (cap=${hardCap})`,
      );

      // 4. Persist transcript first — even if AI fails, PM has the text.
      await prisma.meetingTranscript.upsert({
        where: { meetingId },
        create: {
          meetingId,
          fullText,
          segments: segments as unknown as object,
          language: transcriptLanguage,
          model: process.env.WHISPER_MODEL || 'large-v3',
        },
        update: {
          fullText,
          segments: segments as unknown as object,
          language: transcriptLanguage,
          model: process.env.WHISPER_MODEL || 'large-v3',
          summary: null,
        },
      });
    }
    void transcriptLanguage;

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

/**
 * Post-process WhisperX diarization output: if more SPEAKER_xx labels
 * exist than the participant count, merge the overflow labels into
 * existing ones by time-anchored proximity.
 *
 * Why: pyannote.audio sometimes ignores min/max bounds (e.g. when the
 * underlying ECAPA-TDNN model decides a long monologue is two voices
 * because of energy-level drift). The user then sees SPEAKER_00,
 * SPEAKER_01, SPEAKER_02, SPEAKER_03 in a 2-person call, which the
 * SpeakerEditor UI can't handle gracefully.
 *
 * Algorithm:
 *   1. Bucket all segments by their assigned SPEAKER_xx label.
 *   2. Sort buckets by total speech time (largest = "real" speakers).
 *   3. Keep the top `cap` buckets as-is. Rename their labels to
 *      SPEAKER_00..SPEAKER_(cap-1) — pyannote labels are arbitrary,
 *      contiguous numbering is friendlier for the editor.
 *   4. For each overflow bucket, walk its segments and reassign each
 *      to the kept-bucket whose nearest segment in time has the
 *      smallest gap. Falls back to the longest-time-overlap bucket if
 *      no temporal neighbor exists.
 *
 * Returns segments with their `speaker` field updated. Idempotent;
 * if labels are already within cap, returns the input unchanged.
 */
function capDiarizationLabels(
  segments: TranscriptSegment[],
  cap: number | null,
): TranscriptSegment[] {
  if (!cap || cap < 1) return segments;

  const byLabel = new Map<string, TranscriptSegment[]>();
  for (const s of segments) {
    const lbl = s.speaker;
    if (!lbl) continue;
    if (!byLabel.has(lbl)) byLabel.set(lbl, []);
    byLabel.get(lbl)!.push(s);
  }
  if (byLabel.size <= cap) {
    // Already within bounds — just normalize labels to contiguous
    // SPEAKER_00.. range, sorted by total speech time so SPEAKER_00
    // is the loudest/most-talkative.
    return renumberLabels(segments, byLabel);
  }

  // Rank labels by total speech duration (sum of end-start).
  const ranked = Array.from(byLabel.entries())
    .map(([label, segs]) => ({
      label,
      segs,
      total: segs.reduce((acc, s) => acc + Math.max(0, s.end - s.start), 0),
    }))
    .sort((a, b) => b.total - a.total);

  const keep = ranked.slice(0, cap);
  const overflow = ranked.slice(cap);
  const keepLabels = new Set(keep.map((r) => r.label));

  // For each overflow segment, find the kept label whose nearest
  // segment is temporally closest. Ties broken by larger speech-time
  // bucket (more likely to be the real owner).
  const reassign = new Map<TranscriptSegment, string>();
  for (const bucket of overflow) {
    for (const seg of bucket.segs) {
      let best: { label: string; distance: number; total: number } | null = null;
      for (const target of keep) {
        let minGap = Infinity;
        for (const ks of target.segs) {
          // Gap = time between this seg and the nearest kept seg.
          // Overlap counts as 0 distance.
          if (seg.end < ks.start) {
            minGap = Math.min(minGap, ks.start - seg.end);
          } else if (seg.start > ks.end) {
            minGap = Math.min(minGap, seg.start - ks.end);
          } else {
            minGap = 0;
            break;
          }
        }
        if (
          !best ||
          minGap < best.distance ||
          (minGap === best.distance && target.total > best.total)
        ) {
          best = { label: target.label, distance: minGap, total: target.total };
        }
      }
      if (best) reassign.set(seg, best.label);
    }
  }

  // Apply reassignment + normalize labels to SPEAKER_00..SPEAKER_(cap-1).
  const merged: TranscriptSegment[] = segments.map((s) => {
    if (!s.speaker) return s;
    if (keepLabels.has(s.speaker)) return s;
    const newLabel = reassign.get(s);
    return newLabel ? { ...s, speaker: newLabel } : s;
  });

  // Re-bucket on the merged result and renumber.
  const mergedByLabel = new Map<string, TranscriptSegment[]>();
  for (const s of merged) {
    if (!s.speaker) continue;
    if (!mergedByLabel.has(s.speaker)) mergedByLabel.set(s.speaker, []);
    mergedByLabel.get(s.speaker)!.push(s);
  }
  return renumberLabels(merged, mergedByLabel);
}

/** Rename SPEAKER_xx → contiguous SPEAKER_00.. sorted by total time. */
function renumberLabels(
  segments: TranscriptSegment[],
  byLabel: Map<string, TranscriptSegment[]>,
): TranscriptSegment[] {
  const order = Array.from(byLabel.entries())
    .map(([label, segs]) => ({
      label,
      total: segs.reduce((acc, s) => acc + Math.max(0, s.end - s.start), 0),
    }))
    .sort((a, b) => b.total - a.total)
    .map((x, i) => [x.label, `SPEAKER_${String(i).padStart(2, '0')}`] as const);
  const renameMap = new Map(order);
  return segments.map((s) =>
    s.speaker && renameMap.has(s.speaker)
      ? { ...s, speaker: renameMap.get(s.speaker)! }
      : s,
  );
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
