'use client';

import { useMemo, useState } from 'react';
import { CalendarDays, Columns3, Table2 } from 'lucide-react';
import type { KbColumn, KbRow } from '@/lib/knowledge/getTables';
import { KbTableGrid } from './KbTableGrid';
import { KbTableBoard } from './KbTableBoard';
import { KbTableCalendar } from './KbTableCalendar';

type ViewKind = 'table' | 'board' | 'calendar';

/**
 * Smart-table view switcher (TEAMLY «виды представления»): table grid, board
 * (grouped by a SELECT column), calendar (by a DATE column), plus client-side
 * filter + sort. Views are ephemeral (not persisted) in v1.
 */
export function KbTableViews({
  tableId,
  columns,
  rows,
  canEdit,
}: {
  tableId: string;
  columns: KbColumn[];
  rows: KbRow[];
  canEdit: boolean;
}) {
  const [view, setView] = useState<ViewKind>('table');
  const [filterCol, setFilterCol] = useState('');
  const [filterText, setFilterText] = useState('');
  const [sortCol, setSortCol] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [groupCol, setGroupCol] = useState(() => columns.find((c) => c.type === 'SELECT')?.id ?? '');
  const [dateCol, setDateCol] = useState(() => columns.find((c) => c.type === 'DATE')?.id ?? '');

  const selectCols = columns.filter((c) => c.type === 'SELECT');
  const dateCols = columns.filter((c) => c.type === 'DATE');

  const viewRows = useMemo(() => {
    let r = rows;
    if (filterCol && filterText.trim()) {
      const q = filterText.trim().toLowerCase();
      r = r.filter((row) => (row.values[filterCol] ?? '').toLowerCase().includes(q));
    }
    if (sortCol) {
      const col = columns.find((c) => c.id === sortCol);
      r = [...r].sort((a, b) => {
        const av = a.values[sortCol] ?? '';
        const bv = b.values[sortCol] ?? '';
        let cmp: number;
        if (col?.type === 'NUMBER') cmp = (parseFloat(av) || 0) - (parseFloat(bv) || 0);
        else cmp = av.localeCompare(bv, 'ru');
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return r;
  }, [rows, filterCol, filterText, sortCol, sortDir, columns]);

  const btn = (k: ViewKind, label: string, Icon: typeof Table2) => (
    <button
      type="button"
      onClick={() => setView(k)}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${
        view === k ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'border border-neutral-300 dark:border-neutral-700'
      }`}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {btn('table', 'Таблица', Table2)}
        {btn('board', 'Доска', Columns3)}
        {btn('calendar', 'Календарь', CalendarDays)}

        <span className="mx-1 h-4 w-px bg-neutral-300 dark:bg-neutral-700" />

        {/* filter */}
        <select value={filterCol} onChange={(e) => setFilterCol(e.target.value)} className="rounded border border-neutral-300 px-1 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900">
          <option value="">Фильтр…</option>
          {columns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {filterCol ? (
          <input value={filterText} onChange={(e) => setFilterText(e.target.value)} placeholder="содержит…" className="w-28 rounded border border-neutral-300 px-1 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900" />
        ) : null}

        {/* sort */}
        <select value={sortCol} onChange={(e) => setSortCol(e.target.value)} className="rounded border border-neutral-300 px-1 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900">
          <option value="">Сортировка…</option>
          {columns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {sortCol ? (
          <button type="button" onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))} className="rounded border border-neutral-300 px-1.5 py-1 text-xs dark:border-neutral-700">
            {sortDir === 'asc' ? '↑' : '↓'}
          </button>
        ) : null}

        {view === 'board' && selectCols.length > 0 ? (
          <select value={groupCol} onChange={(e) => setGroupCol(e.target.value)} className="ml-auto rounded border border-neutral-300 px-1 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900">
            {selectCols.map((c) => (
              <option key={c.id} value={c.id}>Группировка: {c.name}</option>
            ))}
          </select>
        ) : null}
        {view === 'calendar' && dateCols.length > 0 ? (
          <select value={dateCol} onChange={(e) => setDateCol(e.target.value)} className="ml-auto rounded border border-neutral-300 px-1 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900">
            {dateCols.map((c) => (
              <option key={c.id} value={c.id}>По дате: {c.name}</option>
            ))}
          </select>
        ) : null}
      </div>

      {view === 'table' ? (
        // Pass the FULL rows + filter/sort descriptors so the grid's structureKey
        // stays stable across filter/sort (no remount → in-progress/just-saved
        // cell edits are preserved); the grid applies filter/sort at render time.
        <KbTableGrid
          tableId={tableId}
          columns={columns}
          rows={rows}
          canEdit={canEdit}
          filter={{ colId: filterCol, text: filterText }}
          sort={{ colId: sortCol, dir: sortDir }}
        />
      ) : view === 'board' ? (
        selectCols.length === 0 ? (
          <Empty text="Добавьте столбец типа «Список», чтобы построить доску." />
        ) : (
          <KbTableBoard columns={columns} rows={viewRows} groupColId={groupCol} canEdit={canEdit} />
        )
      ) : dateCols.length === 0 ? (
        <Empty text="Добавьте столбец типа «Дата», чтобы построить календарь." />
      ) : (
        <KbTableCalendar columns={columns} rows={viewRows} dateColId={dateCol} />
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-muted-foreground dark:border-neutral-700">
      {text}
    </p>
  );
}
