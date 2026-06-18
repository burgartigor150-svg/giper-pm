'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronUp, ChevronDown, Trash2, Plus } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import {
  updateBoardSwimlanesAction,
  type BoardSwimlaneInput,
} from '@/actions/board';
import type { BoardSwimlaneView } from '@/lib/tasks/listTasksForBoard';

type Row = { id: string | null; name: string; wip: string };

type Props = {
  projectId: string;
  initial: BoardSwimlaneView[];
};

/**
 * Manage a project's board swimlanes (horizontal lanes): add, rename, reorder,
 * set a per-lane WIP limit, and delete. Deleting a lane returns its cards to
 * the implicit "no lane". A project with no lanes renders as a single lane.
 */
export function SwimlanesForm({ projectId, initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>(() =>
    [...initial]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        id: s.id,
        name: s.name,
        wip: s.wipLimit != null ? String(s.wipLimit) : '',
      })),
  );

  function move(i: number, dir: -1 | 1) {
    setRows((cur) => {
      const j = i + dir;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }

  function add() {
    setRows((cur) => [...cur, { id: null, name: '', wip: '' }]);
  }

  function remove(i: number) {
    setRows((cur) => cur.filter((_, k) => k !== i));
  }

  function save() {
    setSaved(false);
    setError(null);
    if (rows.some((r) => r.name.trim().length === 0)) {
      setError('У каждой дорожки должно быть название');
      return;
    }
    startTransition(async () => {
      const swimlanes: BoardSwimlaneInput[] = rows.map((r, i) => {
        const w = r.wip.trim();
        const n = w === '' ? null : Math.floor(Number(w));
        return {
          id: r.id,
          name: r.name.trim(),
          wipLimit: n != null && Number.isFinite(n) && n > 0 ? n : null,
          order: i,
        };
      });
      const res = await updateBoardSwimlanesAction(projectId, swimlanes);
      if (res.ok) {
        setSaved(true);
        router.refresh();
        setTimeout(() => setSaved(false), 1500);
      } else {
        setError(res.error.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Горизонтальные дорожки канбана (например, по классу задач или команде).
        Без дорожек доска показывает одну общую полосу. WIP-лимит — максимум
        карточек в дорожке; пусто = без лимита.
      </p>
      {rows.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {rows.map((r, i) => (
            <li
              key={r.id ?? `new-${i}`}
              className="flex items-center gap-2 rounded-md border border-input bg-background p-2"
            >
              <div className="flex shrink-0 flex-col">
                <button
                  type="button"
                  aria-label="Выше"
                  onClick={() => move(i, -1)}
                  disabled={pending || i === 0}
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Ниже"
                  onClick={() => move(i, 1)}
                  disabled={pending || i === rows.length - 1}
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
              <input
                value={r.name}
                onChange={(e) =>
                  setRows((cur) =>
                    cur.map((row, k) => (k === i ? { ...row, name: e.target.value } : row)),
                  )
                }
                disabled={pending}
                maxLength={60}
                placeholder="Название дорожки"
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
              />
              <input
                type="number"
                min={1}
                max={999}
                value={r.wip}
                onChange={(e) =>
                  setRows((cur) =>
                    cur.map((row, k) => (k === i ? { ...row, wip: e.target.value } : row)),
                  )
                }
                disabled={pending}
                placeholder="WIP"
                className="h-9 w-20 shrink-0 rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums"
              />
              <button
                type="button"
                aria-label="Удалить дорожку"
                onClick={() => remove(i)}
                disabled={pending}
                className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Дорожек пока нет.</p>
      )}
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" variant="outline" onClick={add} disabled={pending}>
          <Plus className="mr-1 h-4 w-4" />
          Добавить дорожку
        </Button>
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {pending ? 'Сохраняю…' : 'Сохранить'}
        </Button>
        {saved ? <span className="text-xs text-emerald-600">Сохранено</span> : null}
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </div>
    </div>
  );
}
