/**
 * Thin client for the whisper-asr-webservice container running on T4
 * with `ASR_ENGINE=whisperx` (so we get speaker diarization for free
 * when HF_TOKEN is set).
 *
 * Endpoint:
 *   POST /asr (multipart form: audio_file=@file.wav)
 *   query: encode=true, task=transcribe, language=ru, output=json,
 *          word_timestamps=true, diarize=true (only with HF_TOKEN)
 *
 * Output: { segments: [{ start, end, text, speaker? }], language }
 */

const DEFAULT_BASE = 'http://127.0.0.1:8771';
const REQUEST_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes — Whisper on a 1-hour mp4 takes 5–15 minutes on T4.

export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
  speaker?: string;
};

export type TranscribeResult = {
  language: string | null;
  segments: TranscriptSegment[];
};

function baseUrl(): string {
  return (process.env.WHISPERX_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/$/, '');
}

function diarize(): boolean {
  // Diarization needs HF_TOKEN to be set on the whisperx container; if
  // it's missing, skip the param so the server doesn't error out.
  return !!process.env.HF_TOKEN?.trim();
}

/**
 * Send a WAV/MP3/MP4 buffer to whisperx-server and return the
 * transcript with optional speaker labels.
 */
export async function transcribeAudio(opts: {
  audio: Buffer;
  fileName: string;
  language?: string;
  /**
   * Hint WhisperX about how many distinct voices the recording
   * contains. Without these the diarizer over-splits ("SPEAKER_05"
   * from a single coughing person) or under-splits two soft-voiced
   * speakers. Pass the count of unique participants we expect; the
   * client clamps to a sane range and only sets the query if both
   * are positive.
   */
  minSpeakers?: number | null;
  maxSpeakers?: number | null;
}): Promise<TranscribeResult> {
  const url = new URL(`${baseUrl()}/asr`);
  url.searchParams.set('encode', 'true');
  url.searchParams.set('task', 'transcribe');
  url.searchParams.set('output', 'json');
  url.searchParams.set('word_timestamps', 'true');
  if (opts.language) url.searchParams.set('language', opts.language);
  if (diarize()) {
    url.searchParams.set('diarize', 'true');
    // whisper-asr-webservice forwards these as `min_speakers` /
    // `max_speakers` to pyannote.audio. Clamp 1..20 — pyannote
    // chokes on extremes, and we never expect 20+ in a giper-pm
    // meeting (LiveKit room_max_participants is 50).
    if (opts.minSpeakers && opts.minSpeakers > 0) {
      url.searchParams.set(
        'min_speakers',
        String(Math.min(Math.max(1, opts.minSpeakers), 20)),
      );
    }
    if (opts.maxSpeakers && opts.maxSpeakers > 0) {
      url.searchParams.set(
        'max_speakers',
        String(Math.min(Math.max(1, opts.maxSpeakers), 20)),
      );
    }
  }

  const form = new FormData();
  // Convert Buffer → Uint8Array (with a fresh ArrayBuffer copy) to keep
  // TS DOM lib happy on Node 22 — Buffer's underlying buffer can be a
  // SharedArrayBuffer, which Blob's BlobPart type rejects.
  const view = new Uint8Array(opts.audio.byteLength);
  view.set(opts.audio);
  form.append(
    'audio_file',
    new Blob([view], { type: 'application/octet-stream' }),
    opts.fileName,
  );

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      body: form,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`WhisperX HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      language?: string;
      segments?: { start: number; end: number; text: string; speaker?: string }[];
    };
    const segments = (json.segments ?? []).map((s) => ({
      start: Number(s.start) || 0,
      end: Number(s.end) || 0,
      text: (s.text || '').trim(),
      speaker: s.speaker || undefined,
    }));
    return { language: json.language ?? null, segments };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Quick one-shot transcribe for a TG voice message — assumes the audio
 * is short (<2 min). Returns plain text.
 */
export async function transcribeShort(opts: {
  audio: Buffer;
  fileName: string;
  language?: string;
}): Promise<string> {
  const r = await transcribeAudio(opts);
  return r.segments.map((s) => s.text).join(' ').trim();
}
