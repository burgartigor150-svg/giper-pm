'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import { updateBoardColumnsAction, type BoardColumnInput } from '@/actions/board';
import type { BoardColumnView } from '@/lib/tasks/listTasksForBoard';

type Row = { status: BoardColumnView['status']; name: string; wip: string };

type Props = {
  projectId: string;
  /** Current columns (DB rows or synthesized defaults), any order. */
  initial: BoardColumnView[];
};

/**
 * Manage a project's kanban columns: rename, reorder, and set a per-column WIP
 * limit. Columns map 1:1 to the internal task statuses (shown as a muted tag),
 * so this edits labels/order/WIP rather than adding/removing statuses. Saving
 * upserts every column in one action; order is the row position.
 */
export function BoardColumnsForm({ projectId, initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>(() =>
    [...initial]
      .sort((a, b) => a.order - b.order)
      .map((c) => ({
        status: c.status,
        name: c.name,
        wip: c.wipLimit != null ? String(c.wipLimit) : '',
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

  function save() {
    setSaved(false);
    setError(null);
    if (rows.some((r) => r.name.trim().length === 0)) {
      setError('У каждой колонки должно быть название');
      return;
    }
    startTransition(async () => {
      const columns: BoardColumnInput[] = rows.map((r, i) => {
        const w = r.wip.trim();
        const n = w === '' ? null : Math.floor(Number(w));
        return {
          status: r.status,
          name: r.name.trim(),
          wipLimit: n != null && Number.isFinite(n) && n > 0 ? n : null,
          order: i,
        };
      });
      const res = await updateBoardColumnsAction(projectId, columns);
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
        Колонки канбана: название, порядок (стрелки) и WIP-лимит — максимум
        карточек в колонке. Пусто = без лимита.
      </p>
      <ul className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <li
            key={r.status}
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
              className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
            />
            <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground sm:inline">
              {r.status}
            </span>
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
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {pending ? 'Сохраняю…' : 'Сохранить колонки'}
        </Button>
        {saved ? <span className="text-xs text-emerald-600">Сохранено</span> : null}
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </div>
    </div>
  );
}
