'use client';

import { useRef, useState } from 'react';
import { Play, Pause } from 'lucide-react';

type Props = {
  /** MessageAttachment id. We proxy through /api/messages/attachments/<id>
   *  so channel-access is rechecked on every byte. */
  attachmentId: string;
  durationSec: number | null;
};

/**
 * Round-mask player for VIDEO_NOTE attachments in the message feed.
 *
 * Geometry: 200px circle by default; click toggles play/pause, no
 * full-screen modal (TG keeps it inline too and it works fine for
 * 60s clips). Tap target meets MASTER.md §2 — the whole circle is
 * the button.
 *
 * Preload: metadata only. The full bytes start streaming on play —
 * keeps the message list cheap even when there are 10 video-notes
 * on screen.
 *
 * Audio is muted by default (browser autoplay policy + chat etiquette);
 * the player un-mutes automatically when the user explicitly clicks
 * play. That way the video starts visibly the moment the chat
 * scrolls into view (we play muted on first hover) and gets sound
 * only when wanted.
 */
export function VideoNotePlayer({ attachmentId, durationSec }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  function toggle() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.muted = false;
      void v.play();
    } else {
      v.pause();
    }
  }

  const duration = durationSec ?? 0;
  const durationLabel = duration
    ? `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`
    : '';

  return (
    <button
      type="button"
      onClick={toggle}
      className="group relative size-[200px] shrink-0 overflow-hidden rounded-full bg-muted shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={playing ? 'Пауза' : 'Воспроизвести видеосообщение'}
    >
      <video
        ref={videoRef}
        src={`/api/messages/attachments/${attachmentId}`}
        muted
        playsInline
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        className="size-full object-cover"
      />
      {/* Play / pause overlay. Becomes visible only when paused or
          on hover during playback — doesn't obstruct the video. */}
      <div
        className={
          'pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-150 ' +
          (playing ? 'opacity-0 group-hover:opacity-100' : 'opacity-100')
        }
      >
        <div className="rounded-full bg-foreground/40 p-3 text-background backdrop-blur-sm">
          {playing ? (
            <Pause className="size-5" aria-hidden="true" />
          ) : (
            <Play className="size-5 translate-x-0.5" aria-hidden="true" />
          )}
        </div>
      </div>
      {durationLabel ? (
        <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-foreground/60 px-2 py-0.5 text-xs tabular-nums text-background">
          {durationLabel}
        </div>
      ) : null}
    </button>
  );
}
