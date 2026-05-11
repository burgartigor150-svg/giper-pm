'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { MoreHorizontal, Pin, PinOff, Pencil, Trash2 } from 'lucide-react';
import {
  setPinnedAction,
  editMessageAction,
  deleteMessageAction,
} from '@/actions/messenger';

type Props = {
  messageId: string;
  /** Caller is the author? Controls visibility of edit/delete. */
  isAuthor: boolean;
  /** Caller can pin/unpin in this channel? (channel ADMIN). */
  canPin: boolean;
  /** Currently pinned? */
  pinned: boolean;
  /** Source-of-truth body for the edit form's initial value. */
  currentBody: string;
  /** Called after a successful edit/delete/pin so the parent
   *  optimistically reorders or removes the row. */
  onChanged?: () => void;
};

/**
 * Three-dots menu on a message row. Shown only when at least one
 * action is applicable to the caller — otherwise we render nothing
 * so the row stays clean.
 *
 * Each action self-closes the menu and calls onChanged so the
 * parent can refresh. We deliberately don't optimistically remove
 * the row here; the parent owns the list state.
 */
export function MessageActions({
  messageId,
  isAuthor,
  canPin,
  pinned,
  currentBody,
  onChanged,
}: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentBody);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!isAuthor && !canPin) return null;

  function togglePin() {
    setError(null);
    setOpen(false);
    startTransition(async () => {
      const r = await setPinnedAction(messageId, !pinned);
      if (!r.ok) setError(r.error.message);
      else onChanged?.();
    });
  }
  function startEdit() {
    setDraft(currentBody);
    setEditing(true);
    setOpen(false);
  }
  function commitEdit() {
    if (!draft.trim()) return;
    setError(null);
    startTransition(async () => {
      const r = await editMessageAction(messageId, draft);
      if (!r.ok) {
        setError(r.error.message);
      } else {
        setEditing(false);
        onChanged?.();
      }
    });
  }
  function remove() {
    setOpen(false);
    if (!confirm('Удалить сообщение?')) return;
    setError(null);
    startTransition(async () => {
      const r = await deleteMessageAction(messageId);
      if (!r.ok) setError(r.error.message);
      else onChanged?.();
    });
  }

  if (editing) {
    return (
      <div className="mt-1 flex flex-col gap-1">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commitEdit();
            }
            if (e.key === 'Escape') setEditing(false);
          }}
          rows={2}
          autoFocus
          className="min-h-[40px] w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={commitEdit}
            disabled={pending || !draft.trim()}
            className="rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background hover:bg-foreground/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {pending ? 'Сохраняю…' : 'Сохранить'}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Отмена
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Действия с сообщением"
        aria-expanded={open}
        className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-md border border-border bg-popover shadow-md"
        >
          {canPin ? (
            <button
              type="button"
              role="menuitem"
              onClick={togglePin}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
            >
              {pinned ? (
                <>
                  <PinOff className="size-3.5" />
                  Открепить
                </>
              ) : (
                <>
                  <Pin className="size-3.5" />
                  Закрепить
                </>
              )}
            </button>
          ) : null}
          {isAuthor ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={startEdit}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                <Pencil className="size-3.5" />
                Редактировать
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={remove}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10 focus-visible:outline-none"
              >
                <Trash2 className="size-3.5" />
                Удалить
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <span className="ml-2 text-xs text-destructive" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
