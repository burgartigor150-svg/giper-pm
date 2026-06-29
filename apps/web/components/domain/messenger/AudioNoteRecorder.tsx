'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Square, X, Send, RotateCcw } from 'lucide-react';
import { sendAudioNoteAction } from '@/actions/messenger';

const MAX_DURATION_SEC = 300; // 5 minutes

type RecorderState = 'idle' | 'requesting' | 'recording' | 'preview' | 'uploading' | 'error';

type Props = {
  channelId: string;
  parentId?: string | null;
  onSent: () => void;
  onClose: () => void;
};

/**
 * Push-to-record voice-message recorder. Audio-only sibling of
 * VideoNoteRecorder: getUserMedia(audio) → MediaRecorder → preview <audio>
 * → upload via sendAudioNoteAction. getUserMedia is called only after the
 * user presses Record so no spurious mic prompt appears.
 */
export function AudioNoteRecorder({ channelId, parentId, onSent, onClose }: Props) {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const startedAtRef = useRef<number>(0);
  const playbackRef = useRef<HTMLAudioElement>(null);

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

  useEffect(() => () => teardown(), [teardown]);

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
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const mime = pickSupportedMime();
      const rec = new MediaRecorder(stream, { mimeType: mime ?? undefined });
      recorderRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        blobRef.current = blob;
        previewUrlRef.current = URL.createObjectURL(blob);
        if (playbackRef.current) playbackRef.current.src = previewUrlRef.current;
        setState('preview');
      };
      rec.start();
      startedAtRef.current = Date.now();
      setElapsed(0);
      setState('recording');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось получить доступ к микрофону');
      setState('error');
      teardown();
    }
  }

  useEffect(() => {
    if (state !== 'recording') return;
    const i = window.setInterval(() => {
      const el = (Date.now() - startedAtRef.current) / 1000;
      setElapsed(el);
      if (el >= MAX_DURATION_SEC) stopRecording();
    }, 200);
    return () => window.clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function stopRecording() {
    if (!recorderRef.current) return;
    if (recorderRef.current.state !== 'inactive') recorderRef.current.stop();
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
      const blobMime = blob.type || 'audio/webm';
      const ext = blobMime.includes('mp4') ? 'm4a' : blobMime.includes('ogg') ? 'ogg' : 'webm';
      const fd = new FormData();
      fd.set('channelId', channelId);
      if (parentId) fd.set('parentId', parentId);
      fd.set('file', blob, `voice.${ext}`);
      fd.set('mime', blobMime);
      fd.set('duration', String(elapsed));
      const res = await sendAudioNoteAction(fd);
      if (!res || typeof res !== 'object' || !('ok' in res)) {
        setError('Ошибка отправки. Попробуйте ещё раз.');
        setState('preview');
        return;
      }
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

  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-popover p-3 shadow-sm">
      <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted">
        {state === 'recording' ? (
          <span className="inline-flex items-center gap-1 text-destructive">
            <span className="inline-block size-2.5 animate-pulse rounded-full bg-destructive" />
          </span>
        ) : (
          <Mic className="size-5 text-muted-foreground" aria-hidden="true" />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="text-xs text-muted-foreground" aria-live="polite">
          {state === 'idle' && 'Голосовое сообщение, до 5 минут'}
          {state === 'requesting' && 'Запрашиваем доступ к микрофону…'}
          {state === 'recording' && `Запись… ${elapsedLabel}`}
          {state === 'preview' && `Готово ${elapsedLabel}. Отправить?`}
          {state === 'uploading' && 'Загружаем…'}
          {state === 'error' && (error ?? 'Ошибка')}
        </div>
        <audio
          ref={playbackRef}
          controls
          className={(state === 'preview' || state === 'uploading' ? 'block' : 'hidden') + ' h-8 w-full max-w-[18rem]'}
        />
        {error && state !== 'error' ? <p className="text-xs text-destructive">{error}</p> : null}
        <div className="flex items-center gap-2">
          {(state === 'idle' || state === 'error') && (
            <>
              <button
                type="button"
                onClick={startRecording}
                className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Mic className="size-3.5" />
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
          )}
          {state === 'recording' && (
            <button
              type="button"
              onClick={stopRecording}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Square className="size-3.5 fill-current" />
              Стоп
            </button>
          )}
          {state === 'preview' && (
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
                Заново
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
          )}
          {state === 'uploading' && <div className="text-xs text-muted-foreground">Не закрывайте…</div>}
        </div>
      </div>
    </div>
  );
}

function pickSupportedMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return null;
}
