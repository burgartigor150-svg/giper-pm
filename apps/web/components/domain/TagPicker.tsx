'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { TagPill } from './TagPill';
import {
  assignTagToTaskAction,
  createTagAction,
  unassignTagFromTaskAction,
} from '@/actions/tags';

export type TagOption = {
  id: string;
  name: string;
  slug: string;
  color: string;
};

type Props = {
  taskId: string;
  projectId: string;
  /** Tags currently assigned to the task. */
  assigned: TagOption[];
  /** All tags available in this project (for autocomplete). */
  available: TagOption[];
  canEdit: boolean;
};

/**
 * Tag chips with inline create-on-Enter. Click on the "+" pill to open
 * a small popover with autocomplete; type to filter, Enter to assign or
 * create-and-assign in one shot. Click × on a pill to unassign.
 */
export function TagPicker({ taskId, projectId, assigned, available, canEdit }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [assignedNow, setAssignedNow] = useState(assigned);
  const [availableNow, setAvailableNow] = useState(available);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Stay in sync if parent re-fetches.
  useEffect(() => {
    setAssignedNow(assigned);
  }, [assigned]);
  useEffect(() => {
    setAvailableNow(available);
  }, [available]);

  // Close popover on outside click.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!popoverRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const assignedIds = useMemo(() => new Set(assignedNow.map((t) => t.id)), [assignedNow]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return availableNow
      .filter((t) => !assignedIds.has(t.id))
      .filter((t) => !q || t.name.toLowerCase().includes(q))
      .slice(0, 12);
  }, [availableNow, assignedIds, query]);

  const exactMatch = useMemo(
    () =>
      query.trim() &&
      [...availableNow, ...assignedNow].some(
        (t) => t.name.toLowerCase() === query.trim().toLowerCase(),
      ),
    [query, availableNow, assignedNow],
  );

  function handleAssign(tag: TagOption) {
    setAssignedNow((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
    setQuery('');
    startTransition(async () => {
      const res = await assignTagToTaskAction(taskId, tag.id);
      if (!res.ok) {
        // Roll back the optimistic add.
        setAssignedNow((prev) => prev.filter((t) => t.id !== tag.id));
      }
    });
  }

  function handleUnassign(tag: TagOption) {
    setAssignedNow((prev) => prev.filter((t) => t.id !== tag.id));
    startTransition(async () => {
      const res = await unassignTagFromTaskAction(taskId, tag.id);
      if (!res.ok) {
        setAssignedNow((prev) =>
          [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)),
        );
      }
    });
  }

  function handleCreate() {
    const name = query.trim();
    if (!name) return;
    startTransition(async () => {
      const res = await createTagAction(projectId, name);
      if (res.ok && res.data) {
        const created = res.data;
        if (!availableNow.some((t) => t.id === created.id)) {
          setAvailableNow((prev) => [...prev, created]);
        }
        // assignTagToTaskAction handles the actual link.
        await assignTagToTaskAction(taskId, created.id);
        setAssignedNow((prev) =>
          [...prev, created].sort((a, b) => a.name.localeCompare(b.name)),
        );
        setQuery('');
      }
    });
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered.length > 0) {
        handleAssign(filtered[0]!);
      } else if (query.trim() && !exactMatch) {
        handleCreate();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {assignedNow.map((t) => (
        <TagPill
          key={t.id}
          name={t.name}
          color={t.color}
          onRemove={canEdit ? () => handleUnassign(t) : undefined}
        />
      ))}

      {canEdit ? (
        <div className="relative" ref={popoverRef}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
            disabled={pending}
          >
            + тег
          </button>
          {open ? (
            <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-md border border-border bg-popover p-2 shadow-md">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Найти или создать…"
                className="mb-2 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
              />
              <ul className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
                {filtered.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => handleAssign(t)}
                      className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm hover:bg-accent"
                    >
                      <TagPill name={t.name} color={t.color} />
                    </button>
                  </li>
                ))}
                {filtered.length === 0 && query.trim() && !exactMatch ? (
                  <li>
                    <button
                      type="button"
                      onClick={handleCreate}
                      className="w-full rounded px-2 py-1 text-left text-sm hover:bg-accent"
                    >
                      Создать «{query.trim()}»
                    </button>
                  </li>
                ) : null}
                {filtered.length === 0 && !query.trim() ? (
                  <li className="px-2 py-1 text-xs text-muted-foreground">
                    Все теги уже присвоены
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
