'use client';

import Link from 'next/link';
import { Phone, PhoneOff } from 'lucide-react';

/**
 * Renderer for SYSTEM-source messages (eventKind set). Each event
 * type gets its own card shape — call_started has a Join button,
 * call_ended shows duration with a link to the recording, etc.
 *
 * Keeps system messages visually distinct from chat lines so the
 * eye doesn't confuse "Игорь начал звонок" with a regular message.
 */
export type SystemEvent =
  | 'CALL_STARTED'
  | 'CALL_ENDED'
  | 'MEMBER_CHANGED'
  | 'CHANNEL_RENAMED';

type Props = {
  kind: SystemEvent;
  authorName: string;
  payload: unknown;
  createdAt: Date;
};

export function SystemEventCard({ kind, authorName, payload, createdAt }: Props) {
  if (kind === 'CALL_STARTED') {
    const p = payload as { meetingId?: string; title?: string } | null;
    const meetingId = p?.meetingId;
    return (
      <div className="my-1 inline-flex items-center gap-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
        <Phone className="size-4 text-foreground" aria-hidden="true" />
        <span className="flex-1">
          <span className="font-medium">{authorName}</span> начал(а) звонок
          {p?.title ? ` · ${p.title}` : ''}
        </span>
        {meetingId ? (
          <Link
            href={`/meetings/${meetingId}`}
            className="rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Присоединиться
          </Link>
        ) : null}
      </div>
    );
  }
  if (kind === 'CALL_ENDED') {
    const p = payload as
      | { meetingId?: string; durationSec?: number | null }
      | null;
    const meetingId = p?.meetingId;
    const dur = p?.durationSec ?? 0;
    const durLabel = dur
      ? `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}`
      : null;
    return (
      <div className="my-1 inline-flex items-center gap-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
        <PhoneOff className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="flex-1 text-muted-foreground">
          Звонок завершён{durLabel ? ` · ${durLabel}` : ''}
          {' · '}
          {formatTime(createdAt)}
        </span>
        {meetingId ? (
          <Link
            href={`/meetings/${meetingId}`}
            className="rounded-md border border-input bg-background px-2.5 py-1 text-xs text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Запись
          </Link>
        ) : null}
      </div>
    );
  }
  if (kind === 'CHANNEL_RENAMED') {
    const p = payload as { from?: string; to?: string } | null;
    return (
      <div className="my-1 text-xs text-muted-foreground">
        {authorName} переименовал(а) канал: «{p?.from ?? '—'}» → «{p?.to ?? '—'}»
      </div>
    );
  }
  if (kind === 'MEMBER_CHANGED') {
    const p = payload as
      | { action?: 'added' | 'removed'; userName?: string }
      | null;
    const verb = p?.action === 'removed' ? 'удалил(а)' : 'добавил(а)';
    return (
      <div className="my-1 text-xs text-muted-foreground">
        {authorName} {verb} участника {p?.userName ?? ''}
      </div>
    );
  }
  // Unknown event kind — render as a discreet muted line so we don't
  // crash the message list, but flag it visually.
  return (
    <div className="my-1 text-xs text-muted-foreground italic">
      Системное событие ({kind})
    </div>
  );
}

function formatTime(d: Date): string {
  const dd = new Date(d);
  return `${String(dd.getHours()).padStart(2, '0')}:${String(dd.getMinutes()).padStart(2, '0')}`;
}
