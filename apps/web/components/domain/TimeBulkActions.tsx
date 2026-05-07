'use client';

import { createContext, useContext, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRightLeft, X } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import { bulkReassignTimeEntriesAction } from '@/actions/time';
import { searchTasks, type TaskSearchHit } from '@/actions/tasks';

/**
 * Bulk-actions toolbar for /time. Holds selection state in a context so
 * the table rows can render a checkbox without prop-drilling. When any
 * rows are selected, a sticky action bar appears with "Перенести…" and
 * "Снять выделение".
 */

type Ctx = {
  selected: Set<string>;
  toggle: (id: string) => void;
  toggleAll: (ids: string[]) => void;
  clear: () => void;
  isSelected: (id: string) => boolean;
};

const SelectionCtx = createContext<Ctx | null>(null);

export function TimeSelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const ctx = useMemo<Ctx>(
    () => ({
      selected,
      toggle: (id) =>
        setSelected((cur) => {
          const next = new Set(cur);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      toggleAll: (ids) =>
        setSelected((cur) => {
          // If every id is already selected, clear; otherwise add all.
          const allSelected = ids.every((id) => cur.has(id));
          if (allSelected) {
            const next = new Set(cur);
            for (const id of ids) next.delete(id);
            return next;
          }
          return new Set([...cur, ...ids]);
        }),
      clear: () => setSelected(new Set()),
      isSelected: (id) => selected.has(id),
    }),
    [selected],
  );
  return <SelectionCtx.Provider value={ctx}>{children}</SelectionCtx.Provider>;
}

function useSelection(): Ctx {
  const ctx = useContext(SelectionCtx);
  if (!ctx) throw new Error('useSelection must be used inside TimeSelectionProvider');
  return ctx;
}

export function RowCheckbox({ entryId }: { entryId: string }) {
  const { isSelected, toggle } = useSelection();
  return (
    <input
      type="checkbox"
      checked={isSelected(entryId)}
      onChange={() => toggle(entryId)}
      aria-label="Выбрать запись"
      className="h-4 w-4 cursor-pointer rounded border-input"
    />
  );
}

export function HeaderCheckbox({ entryIds }: { entryIds: string[] }) {
  const { selected, toggleAll } = useSelection();
  const allSelected = entryIds.length > 0 && entryIds.every((id) => selected.has(id));
  const someSelected = entryIds.some((id) => selected.has(id));
  return (
    <input
      type="checkbox"
      checked={allSelected}
      ref={(el) => {
        if (el) el.indeterminate = !allSelected && someSelected;
      }}
      onChange={() => toggleAll(entryIds)}
      aria-label="Выбрать все"
      className="h-4 w-4 cursor-pointer rounded border-input"
    />
  );
}

/**
 * Floating action bar that appears at the bottom of the viewport when at
 * least one entry is selected. Two actions: bulk reassign or clear
 * selection.
 */
export function BulkActionBar() {
  const router = useRouter();
  const { selected, clear } = useSelection();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TaskSearchHit[]>([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (selected.size === 0) return null;

  function search(q: string) {
    setQuery(q);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    searchTasks(q).then(setResults);
  }

  function pick(taskId: string) {
    setError(null);
    startTransition(async () => {
      const res = await bulkReassignTimeEntriesAction([...selected], taskId);
      if (!res.ok) {
        setError(res.error.message);
      } else {
        clear();
        setPickerOpen(false);
        setQuery('');
        setResults([]);
        router.refresh();
      }
    });
  }

  return (
    <div className="fixed inset-x-0 bottom-4 z-40 mx-auto flex max-w-md justify-center px-4">
      <div className="flex w-full flex-col gap-2 rounded-xl border border-border bg-popover p-3 text-sm shadow-2xl">
        <div className="flex items-center gap-3">
          <span className="font-medium">Выбрано: {selected.size}</span>
          {!pickerOpen ? (
            <>
              <Button
                size="sm"
                variant="default"
                onClick={() => setPickerOpen(true)}
                disabled={pending}
              >
                <ArrowRightLeft className="mr-1 h-4 w-4" />
                Перенести…
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={clear}
                disabled={pending}
              >
                <X className="mr-1 h-4 w-4" />
                Снять
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setPickerOpen(false)}>
              <X className="mr-1 h-4 w-4" />
              Отмена
            </Button>
          )}
        </div>
        {pickerOpen ? (
          <>
            <input
              autoFocus
              value={query}
              onChange={(e) => search(e.target.value)}
              placeholder="Найти задачу"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm outline-none"
            />
            {results.length > 0 ? (
              <ul className="max-h-56 overflow-y-auto rounded-md border border-input">
                {results.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => pick(r.id)}
                      className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-accent disabled:opacity-50"
                    >
                      <span className="font-mono text-xs text-muted-foreground">
                        {r.projectKey}-{r.number}
                      </span>
                      <span className="flex-1 truncate">{r.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : query.trim().length >= 2 ? (
              <p className="text-xs text-muted-foreground">Ничего не найдено</p>
            ) : (
              <p className="text-xs text-muted-foreground">Минимум 2 символа</p>
            )}
            {error ? <p className="text-xs text-red-700">{error}</p> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
