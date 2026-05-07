'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { resolveAutoStoppedAction } from '@/actions/time';

type Props = {
  entryId: string;
  /** Total minutes of the auto-closed entry; used as the upper bound on trim. */
  durationMin: number;
};

/**
 * Compact toolbar shown next to an AUTO_STOPPED time entry on /me. Lets
 * the user resolve the row in one click without leaving the page:
 *
 *   - "Оставить"  — accept the auto-stopped duration as real work.
 *   - "Обрезать"  — set the duration to N minutes (input next to the
 *                   button — quick numeric entry).
 *   - "Удалить"   — drop the row (forgotten over lunch / overnight).
 */
export function AutoStoppedActions({ entryId, durationMin }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [trimMode, setTrimMode] = useState(false);
  const [trimMinutes, setTrimMinutes] = useState(60);
  const [error, setError] = useState<string | null>(null);

  function resolve(resolution: 'keep' | 'trim' | 'delete') {
    setError(null);
    startTransition(async () => {
      const res = await resolveAutoStoppedAction(
        entryId,
        resolution,
        resolution === 'trim' ? trimMinutes : undefined,
      );
      if (!res.ok) {
        setError(res.error.message);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded-md bg-red-100 px-2 py-0.5 font-medium uppercase tracking-wide text-red-800">
        Авто-стоп
      </span>
      <span className="text-muted-foreground">Что делать с этой записью?</span>
      <button
        type="button"
        disabled={pending}
        onClick={() => resolve('keep')}
        className="rounded-md border border-input px-2 py-1 hover:bg-accent disabled:opacity-50"
      >
        Оставить
      </button>
      {trimMode ? (
        <span className="inline-flex items-center gap-1">
          <input
            type="number"
            value={trimMinutes}
            onChange={(e) => setTrimMinutes(Math.max(1, Number(e.target.value) || 0))}
            min={1}
            max={durationMin}
            className="h-7 w-16 rounded-md border border-input bg-background px-1.5 text-sm tabular-nums"
            autoFocus
          />
          <span className="text-muted-foreground">мин</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => resolve('trim')}
            className="rounded-md bg-amber-100 px-2 py-1 font-medium text-amber-900 hover:bg-amber-200 disabled:opacity-50"
          >
            Обрезать
          </button>
          <button
            type="button"
            onClick={() => setTrimMode(false)}
            className="text-muted-foreground hover:underline"
          >
            ×
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setTrimMode(true)}
          className="rounded-md border border-input px-2 py-1 hover:bg-accent"
        >
          Обрезать…
        </button>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => resolve('delete')}
        className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-red-700 hover:bg-red-100 disabled:opacity-50"
      >
        Удалить
      </button>
      {error ? <span className="text-red-600">{error}</span> : null}
    </div>
  );
}
