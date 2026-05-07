'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { logTimeAction } from '@/actions/time';
import { searchTasks, type TaskSearchHit } from '@/actions/tasks';

type Props = {
  fromIso: string;
  toIso: string;
  minutes: number;
};

/**
 * One-click affordance to log a forgotten time entry directly inside a
 * detected day-gap. Pick a task from the inline search box and the gap
 * is filled in with a manual entry covering exactly the gap window.
 *
 * No estimate / no note here — the goal is "make it disappear in 5
 * seconds". The user can edit details later from /time if needed.
 */
export function LogGapButton({ fromIso, toIso, minutes }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TaskSearchHit[]>([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
      // Build a minimal FormData payload that matches logTimeSchema. We
      // pass startedAt/endedAt as ISO so the action's date coercion sees
      // the exact gap window.
      const fd = new FormData();
      fd.set('taskId', taskId);
      fd.set('startedAt', fromIso);
      fd.set('endedAt', toIso);
      const res = await logTimeAction(null, fd);
      if (!res.ok) {
        setError(res.error.message);
      } else {
        setOpen(false);
        router.refresh();
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
      >
        Списать ({minutes} мин)
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => search(e.target.value)}
          placeholder="Найти задачу"
          className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm outline-none"
        />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-muted-foreground hover:underline"
        >
          Отмена
        </button>
      </div>
      {results.length > 0 ? (
        <ul className="mt-2 flex max-h-48 flex-col overflow-y-auto rounded-md border border-input bg-background">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                disabled={pending}
                onClick={() => pick(r.id)}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
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
        <p className="mt-2 text-xs text-muted-foreground">Ничего не найдено</p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">Минимум 2 символа</p>
      )}
      {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
