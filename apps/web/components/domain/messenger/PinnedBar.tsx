'use client';

import { useEffect, useState } from 'react';
import { Pin } from 'lucide-react';
import { listPinnedMessagesAction } from '@/actions/messenger';

type Pinned = { id: string; body: string; attachments?: unknown[] };

/**
 * Telegram-style pinned bar shown under the channel header. Loads the
 * channel's pinned messages and surfaces the most recent one; clicking
 * jumps to it in the feed. Hidden when nothing is pinned.
 */
export function PinnedBar({
  channelId,
  onJump,
}: {
  channelId: string;
  onJump: (id: string) => void;
}) {
  const [pinned, setPinned] = useState<Pinned[]>([]);

  useEffect(() => {
    let alive = true;
    void listPinnedMessagesAction(channelId).then((rows) => {
      if (alive) setPinned((rows as Pinned[] | null) ?? []);
    });
    return () => {
      alive = false;
    };
  }, [channelId]);

  if (pinned.length === 0) return null;
  const latest = pinned[0]!;
  const preview = latest.body || (latest.attachments?.length ? 'вложение' : '');

  return (
    <button
      type="button"
      onClick={() => onJump(latest.id)}
      className="flex w-full items-center gap-2 border-b border-border bg-muted/30 px-4 py-1.5 text-left text-xs hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Pin className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
      <span className="font-medium text-foreground">
        Закреплено{pinned.length > 1 ? ` · ${pinned.length}` : ''}
      </span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{preview}</span>
    </button>
  );
}
