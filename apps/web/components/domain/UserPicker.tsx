'use client';

import { useEffect, useRef, useState } from 'react';
import { Avatar } from '@giper/ui/components/Avatar';
import { searchUsersForMention } from '@/actions/messenger';

export type PickerUser = {
  id: string;
  name: string;
  email?: string | null;
  image: string | null;
};

type Props = {
  /** Currently selected user (null = nobody picked yet). */
  value: PickerUser | null;
  /** Called with the picked user, or null when "clear" is pressed. */
  onPick: (user: PickerUser | null) => void;
  /**
   * Pre-load list shown before the user types. Usually the project
   * members + people already on the task — appears instantly so the
   * common case (pick a teammate) doesn't require typing.
   */
  preload?: PickerUser[];
  /** Render a "clear" option in the dropdown. Defaults to true. */
  clearable?: boolean;
  placeholder?: string;
  disabled?: boolean;
  /** Empty-state hint when no preload and no query yet. */
  emptyHint?: string;
};

/**
 * Search-as-you-type user picker reused by Assignee, Reviewer, and the
 * AssignmentList editor. Falls back to searchUsersForMention which
 * already handles active-first ordering and the empty-query top-8.
 *
 * The popup is portaled to absolute-position; click outside to close.
 */
export function UserPicker({
  value,
  onPick,
  preload = [],
  clearable = true,
  placeholder = 'Выбрать…',
  disabled = false,
  emptyHint,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<PickerUser[]>(preload);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      // Reset to preload list when opening.
      setQuery('');
      setMatches(preload);
      setActiveIdx(0);
    }
  }, [open, preload]);

  // Debounced search. Empty query keeps the preload list visible.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setMatches(preload);
      return;
    }
    const t = setTimeout(async () => {
      const users = await searchUsersForMention(q);
      setMatches(users);
      setActiveIdx(0);
    }, 120);
    return () => clearTimeout(t);
  }, [query, open, preload]);

  function pick(u: PickerUser | null) {
    onPick(u);
    setOpen(false);
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (matches[activeIdx]) pick(matches[activeIdx]!);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
      >
        {value ? (
          <>
            <Avatar src={value.image} alt={value.name} className="h-5 w-5" />
            <span className="flex-1 truncate text-left">{value.name}</span>
          </>
        ) : (
          <span className="flex-1 truncate text-left text-muted-foreground">
            {placeholder}
          </span>
        )}
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-full min-w-[240px] rounded-md border border-border bg-popover shadow-md">
          <div className="border-b border-border p-1">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Найти…"
              className="w-full rounded-md border border-transparent bg-background px-2 py-1 text-sm focus:border-input focus:outline-none"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto">
            {clearable && value ? (
              <li>
                <button
                  type="button"
                  onClick={() => pick(null)}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent"
                >
                  — снять —
                </button>
              </li>
            ) : null}
            {matches.length === 0 ? (
              <li className="px-2 py-2 text-xs italic text-muted-foreground">
                {query ? 'Никого не найдено' : (emptyHint ?? 'Начни печатать имя')}
              </li>
            ) : (
              matches.map((u, i) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => pick(u)}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm ${
                      i === activeIdx ? 'bg-accent' : 'hover:bg-accent'
                    }`}
                  >
                    <Avatar src={u.image} alt={u.name} className="h-5 w-5" />
                    <span className="flex-1 truncate">{u.name}</span>
                    {u.email ? (
                      <span className="truncate text-[10px] text-muted-foreground">
                        {u.email}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
