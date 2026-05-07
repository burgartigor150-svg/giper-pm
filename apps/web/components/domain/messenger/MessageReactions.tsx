'use client';

import { useState, useTransition } from 'react';
import { Smile } from 'lucide-react';
import { cn } from '@giper/ui/cn';
import { toggleReactionAction } from '@/actions/messenger';

const QUICK_EMOJIS = ['👍', '❤️', '😄', '🎉', '🔥', '👀', '🙏', '✅'];

type Reaction = { userId: string; emoji: string };

type Props = {
  messageId: string;
  reactions: Reaction[];
  meId: string;
};

/**
 * Aggregated emoji chips below a message. Click a chip to toggle your
 * own reaction; click 😀 to open the quick palette.
 */
export function MessageReactions({ messageId, reactions, meId }: Props) {
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  // Group by emoji preserving stable order: first time we see each one.
  const groups: Array<{ emoji: string; users: string[] }> = [];
  for (const r of reactions) {
    const g = groups.find((x) => x.emoji === r.emoji);
    if (g) g.users.push(r.userId);
    else groups.push({ emoji: r.emoji, users: [r.userId] });
  }

  function toggle(emoji: string) {
    setOpen(false);
    startTransition(async () => {
      await toggleReactionAction(messageId, emoji);
      // The WS event will trigger a refresh of the parent list — no
      // local optimistic update here to keep the row stateless.
    });
  }

  if (groups.length === 0 && !open) {
    return (
      <div className="mt-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 rounded border border-dashed border-border px-1.5 py-0.5 text-[11px] text-muted-foreground opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-100"
          aria-label="Добавить реакцию"
        >
          <Smile className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative mt-1 flex flex-wrap items-center gap-1">
      {groups.map((g) => {
        const mine = g.users.includes(meId);
        return (
          <button
            key={g.emoji}
            type="button"
            onClick={() => toggle(g.emoji)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] leading-none',
              mine
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-border bg-muted text-foreground hover:bg-accent',
            )}
          >
            <span>{g.emoji}</span>
            <span className="text-[10px]">{g.users.length}</span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground hover:bg-accent"
        aria-label="Добавить реакцию"
      >
        <Smile className="h-3 w-3" />
      </button>
      {open ? (
        <div className="absolute bottom-full left-0 z-30 mb-1 flex gap-1 rounded-md border border-border bg-popover p-1 shadow-md">
          {QUICK_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => toggle(e)}
              className="rounded px-1.5 py-0.5 text-base hover:bg-accent"
            >
              {e}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
