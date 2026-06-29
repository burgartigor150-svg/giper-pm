'use client';

import { Mic } from 'lucide-react';

/**
 * Voice-message player. Streams from the hardened attachment proxy
 * (audio/* is inline-safe + Range-enabled, so the native <audio> element
 * can seek). Keeps it deliberately simple — the browser's own controls
 * cover play/pause/seek/scrub; we add a mic glyph + duration label so it
 * reads as a voice note rather than a generic file.
 */
export function AudioNotePlayer({
  attachmentId,
  durationSec,
}: {
  attachmentId: string;
  durationSec: number | null;
}) {
  const label =
    durationSec && durationSec > 0
      ? `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}`
      : null;
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1.5">
      <Mic className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <audio
        controls
        preload="metadata"
        src={`/api/messages/attachments/${attachmentId}`}
        className="h-8 max-w-[16rem]"
      />
      {label ? <span className="text-xs tabular-nums text-muted-foreground">{label}</span> : null}
    </div>
  );
}
