'use client';

import { useEffect, useRef, useState } from 'react';

const EMOJIS = [
  '📘', '📗', '📙', '📕', '📔', '📓', '📚', '📖', '📝', '🗂️',
  '📁', '📂', '🗃️', '🗄️', '📋', '📌', '📎', '🔖', '🏷️', '✅',
  '⭐', '🔥', '💡', '⚙️', '🔧', '🛠️', '🚀', '🎯', '📈', '📊',
  '🧩', '🔐', '🔑', '👥', '💬', '❓', 'ℹ️', '⚠️', '🎓', '🧠',
  '🌐', '💼', '🏢', '🧾', '📅', '🗓️', '🧭', '🪪', '🧪', '🩺',
];

/**
 * Tiny dependency-free emoji picker for space/article icons. Renders the
 * current icon as a trigger button; a popover grid sets/clears it.
 */
export function KbEmojiPicker({
  value,
  onSelect,
  disabled,
  size = 'md',
}: {
  value: string | null;
  onSelect: (emoji: string | null) => void;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const trigger =
    size === 'lg' ? 'h-10 w-10 text-2xl' : size === 'sm' ? 'h-6 w-6 text-sm' : 'h-8 w-8 text-lg';

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`flex ${trigger} items-center justify-center rounded-md border border-neutral-300 hover:bg-muted disabled:opacity-50 dark:border-neutral-700`}
        aria-label="Выбрать иконку"
        title="Иконка"
      >
        {value ?? '🙂'}
      </button>
      {open ? (
        <div className="absolute left-0 z-50 mt-1 w-64 rounded-lg border border-neutral-200 bg-background p-2 shadow-lg dark:border-neutral-700">
          <div className="grid grid-cols-8 gap-1">
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => {
                  onSelect(e);
                  setOpen(false);
                }}
                className={`flex h-7 w-7 items-center justify-center rounded text-lg hover:bg-muted ${
                  value === e ? 'bg-muted ring-1 ring-neutral-400' : ''
                }`}
              >
                {e}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              onSelect(null);
              setOpen(false);
            }}
            className="mt-2 w-full rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            Убрать иконку
          </button>
        </div>
      ) : null}
    </div>
  );
}
