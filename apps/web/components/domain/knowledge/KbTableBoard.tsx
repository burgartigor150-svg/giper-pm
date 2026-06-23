'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { KbColumn, KbRow } from '@/lib/knowledge/getTables';
import { updateCellAction } from '@/actions/knowledgeTables';

const NONE = '__none__';

/** Kanban board: rows grouped by a SELECT column; change a card's group inline. */
export function KbTableBoard({
  columns,
  rows,
  groupColId,
  canEdit,
}: {
  columns: KbColumn[];
  rows: KbRow[];
  groupColId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const groupCol = columns.find((c) => c.id === groupColId);
  const labelCol = columns[0];
  const otherCols = columns.filter((c) => c.id !== groupColId).slice(0, 4);

  const options = [...(groupCol?.options ?? []), ''];
  const colsByValue = new Map<string, KbRow[]>();
  for (const opt of options) colsByValue.set(opt || NONE, []);
  for (const row of rows) {
    const v = row.values[groupColId] ?? '';
    const key = v || NONE;
    if (!colsByValue.has(key)) colsByValue.set(key, []); // value not in current options
    colsByValue.get(key)!.push(row);
  }

  function move(rowId: string, value: string) {
    startTransition(async () => {
      const res = await updateCellAction(rowId, groupColId, value);
      if (res.ok) router.refresh();
      else alert(res.error.message);
    });
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {[...colsByValue.entries()].map(([key, colRows]) => (
        <div key={key} className="flex w-64 shrink-0 flex-col gap-2 rounded-lg border border-neutral-200 bg-muted/30 p-2 dark:border-neutral-800">
          <div className="flex items-center justify-between px-1">
            <span className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {key === NONE ? 'Без значения' : key}
            </span>
            <span className="text-xs text-muted-foreground">{colRows.length}</span>
          </div>
          {colRows.map((row) => (
            <div key={row.id} className="rounded-md border border-neutral-200 bg-background p-2 text-sm dark:border-neutral-800">
              <p className="truncate font-medium">{(labelCol && row.values[labelCol.id]) || 'Без названия'}</p>
              {otherCols.map((c) => {
                const val = row.values[c.id];
                if (!val) return null;
                return (
                  <p key={c.id} className="truncate text-xs text-muted-foreground">
                    <span className="opacity-70">{c.name}:</span>{' '}
                    {c.type === 'CHECKBOX' ? (val === 'true' ? '✓' : '—') : val}
                  </p>
                );
              })}
              {canEdit && groupCol ? (
                <select
                  value={row.values[groupColId] ?? ''}
                  onChange={(e) => move(row.id, e.target.value)}
                  disabled={pending}
                  className="mt-1.5 w-full rounded border border-neutral-300 px-1 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                >
                  <option value="">— без значения —</option>
                  {(groupCol.options ?? []).map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              ) : null}
            </div>
          ))}
          {colRows.length === 0 ? <p className="px-1 py-2 text-xs text-muted-foreground">Пусто</p> : null}
        </div>
      ))}
    </div>
  );
}
