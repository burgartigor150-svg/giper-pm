'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Square, X, Send, RotateCcw } from 'lucide-react';

const MAX_DURATION_SEC = 60;
// Target a square viewport — Telegram-style round notes. Mobile front
// cameras don't natively shoot square, so we ask the recorder for the
// largest available square cropped from the centre. 480 is a fair
// balance: sharper than TG's 240, but still small enough that a 60s
// clip fits in ~5 MB at the bitrate below.
const TARGET_SIDE = 480;
const TARGET_BITRATE = 700_000; // ~700 kbps video

type RecorderState = 'idle' | 'requesting' | 'recording' | 'preview' | 'uploading' | 'error';

type Props = {
  channelId: string;
  parentId?: string | null;
  onSent: () => void;
  onClose: () => void;
};

/**
 * Round-mask MediaRecorder for chat. Hosts the preview <video>, the
 * timer, and a tiny three-state toolbar (start → stop → upload/discard).
 *
 * Permissions: the browser raises a getUserMedia prompt the first time
 * the recorder is opened. We deliberately call gUM only after the user
 * presses the camera button (not on mount) so the prompt doesn't appear
 * spuriously when the user opens a chat near the composer.
 *
 * Codec: we let MediaRecorder pick (webm/vp9 on Chrome/Firefox, mp4/h264
 * on Safari). Both decode universally in modern browsers, and our /api
 * proxy preserves the original Content-Type. No server-side transcode.
 */
export function VideoNoteRecorder({ channelId, parentId, onSent, onClose }: Props) {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const startedAtRef = useRef<number>(0);
  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const playbackVideoRef = useRef<HTMLVideoElement>(null);

  // Tear-down helper. Idempotent — safe to call from useEffect cleanup
  // even if we never started a stream.
  const teardown = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop();
      } catch {
        /* already stopped */
      }
    }
    recorderRef.current = null;
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) t.stop();
      streamRef.current = null;
    }
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    chunksRef.current = [];
    blobRef.current = null;
  }, []);

  // Always tear down on unmount so the camera light goes off even if
  // the parent unmounts us mid-recording.
  useEffect(() => () => teardown(), [teardown]);

  // Esc closes the recorder at any non-uploading state.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && state !== 'uploading') {
        teardown();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, teardown, onClose]);

  async function startRecording() {
    setError(null);
    setState('requesting');
    try {
      // Square video constraint — the browser picks the closest
      // resolution; we'll CSS-mask to a circle either way.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: TARGET_SIDE },
          height: { ideal: TARGET_SIDE },
          aspectRatio: { ideal: 1 },
          facingMode: 'user',
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream;
        // Safari needs an explicit play() after attaching srcObject.
        await liveVideoRef.current.play().catch(() => undefined);
      }
      // Pick best supported MIME — Chrome/FF prefer vp9, Safari mp4.
      const mime = pickSupportedMime();
      const rec = new MediaRecorder(stream, {
        mimeType: mime ?? undefined,
        videoBitsPerSecond: TARGET_BITRATE,
      });
      recorderRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: rec.mimeType || 'video/webm',
        });
        blobRef.current = blob;
        previewUrlRef.current = URL.createObjectURL(blob);
        if (playbackVideoRef.current) {
          playbackVideoRef.current.src = previewUrlRef.current;
        }
        setState('preview');
      };
      rec.start();
      startedAtRef.current = Date.now();
      setElapsed(0);
      setState('recording');
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Не удалось получить доступ к камере / микрофону',
      );
      setState('error');
      teardown();
    }
  }

  // 100ms tick during recording to update the timer + auto-stop at cap.
  useEffect(() => {
    if (state !== 'recording') return;
    const i = window.setInterval(() => {
      const el = (Date.now() - startedAtRef.current) / 1000;
      setElapsed(el);
      if (el >= MAX_DURATION_SEC) {
        stopRecording();
      }
    }, 100);
    return () => window.clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function stopRecording() {
    if (!recorderRef.current) return;
    if (recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    // Stop camera tracks immediately — we don't need them in the
    // preview state, and leaving them open keeps the privacy
    // indicator on.
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) t.stop();
      streamRef.current = null;
    }
  }

  function retake() {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    blobRef.current = null;
    chunksRef.current = [];
    setElapsed(0);
    setState('idle');
  }

  async function upload() {
    const blob = blobRef.current;
    if (!blob) return;
    setState('uploading');
    setError(null);
    try {
      const fd = new FormData();
      fd.set('channelId', channelId);
      if (parentId) fd.set('parentId', parentId);
      // Pick extension from mime so the server stores .mp4 / .webm
      // correctly without a transcoder hop. We also send the mime
      // out-of-band: React Server Action FormData transport can
      // flatten Blob.type to text/plain on the wire, so the server
      // would otherwise reject the upload.
      const blobMime = blob.type || 'video/webm';
      const ext = blobMime.startsWith('video/mp4') ? 'mp4' : 'webm';
      fd.set('file', blob, `video-note.${ext}`);
      fd.set('mime', blobMime);
      fd.set('duration', String(elapsed));
      // We don't have the recorded video's intrinsic dimensions yet
      // (the playback element knows them only after metadata is
      // loaded). Use the target side as a best-effort hint; the
      // server stores it for the player's aspect-ratio reservation.
      const side =
        playbackVideoRef.current?.videoWidth ||
        liveVideoRef.current?.videoWidth ||
        TARGET_SIDE;
      const sideH =
        playbackVideoRef.current?.videoHeight ||
        liveVideoRef.current?.videoHeight ||
        TARGET_SIDE;
      fd.set('width', String(side));
      fd.set('height', String(sideH));

      const { sendVideoNoteAction } = await import('@/actions/messenger');
      const res = await sendVideoNoteAction(fd);
      if (!res.ok) {
        setError(res.error.message);
        setState('preview');
        return;
      }
      teardown();
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отправить');
      setState('preview');
    }
  }

  const elapsedSec = Math.min(MAX_DURATION_SEC, Math.floor(elapsed));
  const elapsedLabel = `${String(Math.floor(elapsedSec / 60)).padStart(1, '0')}:${String(elapsedSec % 60).padStart(2, '0')}`;
  const progress = Math.min(1, elapsed / MAX_DURATION_SEC);

  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-popover p-3 shadow-sm">
      {/* Round video viewport. Same element used for live preview
          during recording AND playback after stop — we just swap
          which video element is visible based on state. */}
      <div className="relative size-32 shrink-0 overflow-hidden rounded-full bg-muted">
        <video
          ref={liveVideoRef}
          muted
          playsInline
          autoPlay
          className={
            (state === 'recording' || state === 'requesting' ? 'block' : 'hidden') +
            ' size-full object-cover'
          }
        />
        <video
          ref={playbackVideoRef}
          playsInline
          controls
          className={
            (state === 'preview' || state === 'uploading' ? 'block' : 'hidden') +
            ' size-full object-cover'
          }
        />
        {state === 'idle' || state === 'error' ? (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <Camera className="size-8" aria-hidden="true" />
          </div>
        ) : null}
        {state === 'recording' ? (
          <div
            className="absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-destructive/90 px-2 py-0.5 text-xs font-semibold tabular-nums text-destructive-foreground"
            aria-live="polite"
          >
            <span className="inline-block size-2 animate-pulse rounded-full bg-white" />
            {elapsedLabel}
          </div>
        ) : null}
        {state === 'recording' ? (
          <svg
            className="pointer-events-none absolute inset-0 -rotate-90"
            viewBox="0 0 100 100"
            aria-hidden="true"
          >
            <circle
              cx="50"
              cy="50"
              r="48"
              fill="none"
              stroke="rgb(239 68 68)"
              strokeWidth="3"
              strokeDasharray={`${progress * 301.6} 301.6`}
            />
          </svg>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="text-xs text-muted-foreground">
          {state === 'idle' && 'Видеосообщение, до 60 секунд'}
          {state === 'requesting' && 'Запрашиваем доступ к камере…'}
          {state === 'recording' && `Запись… ${elapsedLabel} / 1:00`}
          {state === 'preview' && `Готово ${elapsedLabel}. Отправить?`}
          {state === 'uploading' && 'Загружаем…'}
          {state === 'error' && (error ?? 'Ошибка')}
        </div>
        {error && state !== 'error' ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : null}
        <div className="flex items-center gap-2">
          {state === 'idle' || state === 'error' ? (
            <>
              <button
                type="button"
                onClick={startRecording}
                className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Camera className="size-3.5" />
                Записать
              </button>
              <button
                type="button"
                onClick={() => {
                  teardown();
                  onClose();
                }}
                className="rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Отмена
              </button>
            </>
          ) : null}
          {state === 'recording' ? (
            <button
              type="button"
              onClick={stopRecording}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Square className="size-3.5 fill-current" />
              Стоп
            </button>
          ) : null}
          {state === 'preview' ? (
            <>
              <button
                type="button"
                onClick={upload}
                className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Send className="size-3.5" />
                Отправить
              </button>
              <button
                type="button"
                onClick={retake}
                className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <RotateCcw className="size-3.5" />
                Переснять
              </button>
              <button
                type="button"
                onClick={() => {
                  teardown();
                  onClose();
                }}
                className="rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Отмена"
              >
                <X className="size-3.5" />
              </button>
            </>
          ) : null}
          {state === 'uploading' ? (
            <div className="text-xs text-muted-foreground">Не закрывайте…</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function pickSupportedMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  // Prefer mp4 if the browser supports it (Safari + recent Chrome on
  // macOS) — produces broadly-playable files. Fall back to vp9-webm
  // on Firefox / older Chrome.
  const candidates = [
    'video/mp4;codecs=avc1,mp4a',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return null;
}
