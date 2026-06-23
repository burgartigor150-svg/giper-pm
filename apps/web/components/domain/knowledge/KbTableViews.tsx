'use client';

import { useMemo, useState } from 'react';
import { CalendarDays, Columns3, FormInput, Table2 } from 'lucide-react';
import type { KbColumn, KbRow } from '@/lib/knowledge/getTables';
import { displayCellValue, cellNumber, type KbRelationMap } from '@/lib/knowledge/tableCompute';
import { KbTableGrid, type KbTableRef } from './KbTableGrid';
import { KbTableBoard } from './KbTableBoard';
import { KbTableCalendar } from './KbTableCalendar';
import { KbTableForm } from './KbTableForm';

type ViewKind = 'table' | 'board' | 'calendar' | 'form';

/**
 * Smart-table view switcher (TEAMLY «виды представления»): table grid, board
 * (grouped by a SELECT column), calendar (by a DATE column), form (data entry),
 * plus client-side filter + sort. Views are ephemeral (not persisted) in v1.
 */
export function KbTableViews({
  tableId,
  columns,
  rows,
  canEdit,
  relations = {},
  spaceTables = [],
}: {
  tableId: string;
  columns: KbColumn[];
  rows: KbRow[];
  canEdit: boolean;
  relations?: KbRelationMap;
  spaceTables?: KbTableRef[];
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
    const byId = new Map(columns.map((c) => [c.id, c]));
    let r = rows;
    if (filterCol && filterText.trim()) {
      const q = filterText.trim().toLowerCase();
      const col = byId.get(filterCol);
      r = r.filter((row) =>
        col
          ? displayCellValue(col, row, columns, relations).toLowerCase().includes(q)
          : (row.values[filterCol] ?? '').toLowerCase().includes(q),
      );
    }
    if (sortCol) {
      const col = byId.get(sortCol);
      r = [...r].sort((a, b) => {
        let cmp: number;
        if (col && (col.type === 'NUMBER' || col.type === 'FORMULA')) {
          cmp = cellNumber(col, a, columns) - cellNumber(col, b, columns);
        } else if (col) {
          cmp = displayCellValue(col, a, columns, relations).localeCompare(
            displayCellValue(col, b, columns, relations),
            'ru',
          );
        } else cmp = 0;
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return r;
  }, [rows, filterCol, filterText, sortCol, sortDir, columns, relations]);

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
        {btn('form', 'Форма', FormInput)}

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
          relations={relations}
          spaceTables={spaceTables}
        />
      ) : view === 'board' ? (
        selectCols.length === 0 ? (
          <Empty text="Добавьте столбец типа «Список», чтобы построить доску." />
        ) : (
          <KbTableBoard columns={columns} rows={viewRows} groupColId={groupCol} canEdit={canEdit} relations={relations} />
        )
      ) : view === 'calendar' ? (
        dateCols.length === 0 ? (
          <Empty text="Добавьте столбец типа «Дата», чтобы построить календарь." />
        ) : (
          <KbTableCalendar columns={columns} rows={viewRows} dateColId={dateCol} />
        )
      ) : (
        <KbTableForm tableId={tableId} columns={columns} rowCount={rows.length} relations={relations} canEdit={canEdit} />
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
