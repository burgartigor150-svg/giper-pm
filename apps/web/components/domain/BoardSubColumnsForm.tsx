'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronUp, ChevronDown, Trash2, Plus } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import {
  updateBoardSubColumnsAction,
  type BoardSubColumnInput,
} from '@/actions/board';

type SubCol = { id: string; name: string; wipLimit: number | null; order: number };
type Col = { id: string; name: string; subColumns: SubCol[] };

/**
 * Manage sub-columns (sub-stages) of a chosen board column. Pick a column, then
 * add/rename/reorder/delete its sub-columns + per-sub WIP. A column with no
 * sub-columns renders as a normal column on the board.
 */
export function BoardSubColumnsForm({ columns }: { columns: Col[] }) {
  const [colId, setColId] = useState(columns[0]?.id ?? '');
  const selected = columns.find((c) => c.id === colId);

  if (columns.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Сначала создайте колонки доски (выше), затем сможете добавить им подколонки.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Подколонки делят колонку на под-этапы (например, «В работе» → «Разработка»
        / «Ревью»). Без подколонок колонка выглядит как обычно.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Колонка:</span>
        <select
          value={colId}
          onChange={(e) => setColId(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          {columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {selected ? (
        <ColumnEditor key={selected.id} columnId={selected.id} initial={selected.subColumns} />
      ) : null}
    </div>
  );
}

type Row = { id: string | null; name: string; wip: string };

function ColumnEditor({ columnId, initial }: { columnId: string; initial: SubCol[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>(() =>
    [...initial]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ id: s.id, name: s.name, wip: s.wipLimit != null ? String(s.wipLimit) : '' })),
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
      setError('У каждой подколонки должно быть название');
      return;
    }
    startTransition(async () => {
      const subColumns: BoardSubColumnInput[] = rows.map((r, i) => {
        const w = r.wip.trim();
        const n = w === '' ? null : Math.floor(Number(w));
        return {
          id: r.id,
          name: r.name.trim(),
          wipLimit: n != null && Number.isFinite(n) && n > 0 ? n : null,
          order: i,
        };
      });
      const res = await updateBoardSubColumnsAction(columnId, subColumns);
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
    <div className="flex flex-col gap-2">
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
                  setRows((cur) => cur.map((row, k) => (k === i ? { ...row, name: e.target.value } : row)))
                }
                disabled={pending}
                maxLength={60}
                placeholder="Название подколонки"
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
              />
              <input
                type="number"
                min={1}
                max={999}
                value={r.wip}
                onChange={(e) =>
                  setRows((cur) => cur.map((row, k) => (k === i ? { ...row, wip: e.target.value } : row)))
                }
                disabled={pending}
                placeholder="WIP"
                className="h-9 w-20 shrink-0 rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums"
              />
              <button
                type="button"
                aria-label="Удалить подколонку"
                onClick={() => setRows((cur) => cur.filter((_, k) => k !== i))}
                disabled={pending}
                className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Подколонок нет — колонка обычная.</p>
      )}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setRows((cur) => [...cur, { id: null, name: '', wip: '' }])}
          disabled={pending}
        >
          <Plus className="mr-1 h-4 w-4" />
          Добавить подколонку
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
