'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { ListPlus, Search, X } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import {
  listSprintPlanningTasksAction,
  updateSprintMembershipAction,
  type SprintPlanningTask,
} from '@/actions/sprints';

const STATUS_LABEL: Record<string, string> = {
  BACKLOG: 'Бэклог',
  TODO: 'К работе',
  IN_PROGRESS: 'В работе',
  TESTING: 'Тест',
  REVIEW: 'Ревью',
  BLOCKED: 'Заблок.',
  DONE: 'Готово',
  CANCELED: 'Отмена',
};

/**
 * Sprint planning: add/remove tasks from the active sprint in one place,
 * without opening each card. Lists the project's visible tasks (searchable),
 * checkbox = "in this sprint"; Save applies the diff (per-task gated server
 * side). Lives on the sprints page next to the active-sprint board.
 */
export function SprintPlanningDialog({
  projectKey,
  sprintId,
  sprintName,
}: {
  projectKey: string;
  sprintId: string;
  sprintName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SprintPlanningTask[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Membership at load time (per id, recorded once) and the user's overrides.
  const original = useRef<Map<string, boolean>>(new Map());
  const [desired, setDesired] = useState<Map<string, boolean>>(new Map());

  // Load candidates on open and whenever the (debounced) query changes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(() => {
      // Spinner only once the request actually fires — debounce shouldn't flash
      // the list to «Загрузка…» on every keystroke.
      setLoading(true);
      listSprintPlanningTasksAction(projectKey, sprintId, query).then((res) => {
        if (cancelled) return;
        setLoading(false);
        if (res.ok && res.data) {
          for (const it of res.data.items) {
            if (!original.current.has(it.id)) original.current.set(it.id, it.inSprint);
          }
          setItems(res.data.items);
          setHasMore(res.data.hasMore);
        } else if (!res.ok) {
          setError(res.error.message);
        }
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, query, projectKey, sprintId]);

  // Reset transient state on close.
  useEffect(() => {
    if (open) return;
    setQuery('');
    setItems(null);
    setHasMore(false);
    setLoading(false);
    setError(null);
    original.current = new Map();
    setDesired(new Map());
  }, [open]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const isChecked = (it: SprintPlanningTask) =>
    desired.has(it.id) ? !!desired.get(it.id) : (original.current.get(it.id) ?? it.inSprint);

  const toggle = (it: SprintPlanningTask) =>
    setDesired((cur) => {
      const next = new Map(cur);
      next.set(it.id, !isChecked(it));
      return next;
    });

  // Diff against the recorded original membership.
  const addIds: string[] = [];
  const removeIds: string[] = [];
  for (const [id, want] of desired) {
    const orig = original.current.get(id) ?? false;
    if (want && !orig) addIds.push(id);
    else if (!want && orig) removeIds.push(id);
  }
  const changed = addIds.length + removeIds.length;

  function save() {
    if (changed === 0) {
      setOpen(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await updateSprintMembershipAction(sprintId, addIds, removeIds);
      if (res.ok) {
        router.refresh();
        setOpen(false);
      } else {
        setError(res.error.message);
      }
    });
  }

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        <ListPlus className="mr-1 h-4 w-4" />
        Добавить задачи
      </Button>
      {typeof document !== 'undefined' && open
        ? createPortal(
            <div
              className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-3 pt-[8vh] md:pt-[12vh]"
              onClick={() => !pending && setOpen(false)}
            >
              <div
                data-no-shortcuts
                className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b px-4 py-2.5">
                  <div className="text-sm font-medium">Состав спринта: {sprintName}</div>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded p-1 text-muted-foreground hover:bg-accent"
                    aria-label="Закрыть"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="border-b px-4 py-2.5">
                  <div className="flex items-center gap-2 rounded-md border border-input bg-background px-2">
                    <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <input
                      autoFocus
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Поиск задач по названию или номеру…"
                      className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none"
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Отметьте задачи — они попадут в спринт. Снимите отметку, чтобы убрать.
                  </p>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  {items === null || loading ? (
                    <p className="px-2 py-4 text-sm text-muted-foreground">Загрузка…</p>
                  ) : items.length === 0 ? (
                    <p className="px-2 py-4 text-sm text-muted-foreground">
                      {query ? 'Ничего не найдено.' : 'В проекте пока нет задач.'}
                    </p>
                  ) : (
                    <ul className="flex flex-col">
                      {items.map((it) => (
                        <li key={it.id}>
                          <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted">
                            <input
                              type="checkbox"
                              checked={isChecked(it)}
                              onChange={() => toggle(it)}
                              disabled={pending}
                              className="h-4 w-4 shrink-0 rounded border-input"
                            />
                            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                              {projectKey}-{it.number}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm">{it.title}</span>
                            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                              {STATUS_LABEL[it.internalStatus] ?? it.internalStatus}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                  {hasMore ? (
                    <p className="px-2 py-2 text-xs text-muted-foreground">
                      Показаны не все задачи — уточните поиск, чтобы найти нужные.
                    </p>
                  ) : null}
                </div>

                <div className="flex items-center justify-between border-t px-4 py-2.5">
                  <span className="text-xs text-muted-foreground">
                    {changed > 0
                      ? `Изменений: +${addIds.length} / −${removeIds.length}`
                      : 'Нет изменений'}
                  </span>
                  <div className="flex items-center gap-2">
                    {error ? <span className="text-xs text-red-600">{error}</span> : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setOpen(false)}
                      disabled={pending}
                    >
                      Отмена
                    </Button>
                    <Button type="button" size="sm" onClick={save} disabled={pending || changed === 0}>
                      {pending ? 'Сохраняю…' : 'Сохранить'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
