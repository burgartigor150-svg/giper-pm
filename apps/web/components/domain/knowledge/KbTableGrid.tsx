'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import {
  addColumnAction,
  updateColumnAction,
  deleteColumnAction,
  addRowAction,
  deleteRowAction,
  updateCellAction,
} from '@/actions/knowledgeTables';
import type { KbColumn, KbRow, KbColumnType } from '@/lib/knowledge/getTables';

const TYPE_LABELS: Record<KbColumnType, string> = {
  TEXT: 'Текст',
  NUMBER: 'Число',
  DATE: 'Дата',
  CHECKBOX: 'Чек-бокс',
  SELECT: 'Список',
  URL: 'Ссылка',
};

/**
 * Editable smart-table grid. Structural changes (add/remove column or row) come
 * from server props and remount the body via `structureKey`; cell edits live in
 * local state and persist atomically (jsonb_set) so concurrent edits to other
 * cells aren't clobbered.
 */
export type KbGridFilter = { colId: string; text: string };
export type KbGridSort = { colId: string; dir: 'asc' | 'desc' };

export function KbTableGrid({
  tableId,
  columns,
  rows,
  canEdit,
  filter,
  sort,
}: {
  tableId: string;
  columns: KbColumn[];
  rows: KbRow[];
  canEdit: boolean;
  filter?: KbGridFilter;
  sort?: KbGridSort;
}) {
  // Include a hash of server cell values so a refetch with changed values (a
  // concurrent edit, another tab) remounts the body and re-seeds local state.
  // Local cell edits don't touch the `rows` prop, so typing isn't interrupted.
  // Filter/sort are applied INSIDE GridInner (render-time) so they never change
  // structureKey → no remount → no stale re-seed of just-saved edits.
  const structureKey = `${columns.map((c) => c.id).join(',')}|${rows
    .map((r) => `${r.id}:${JSON.stringify(r.values)}`)
    .join(',')}`;
  return (
    <GridInner key={structureKey} tableId={tableId} columns={columns} rows={rows} canEdit={canEdit} filter={filter} sort={sort} />
  );
}

function GridInner({
  tableId,
  columns,
  rows,
  canEdit,
  filter,
  sort,
}: {
  tableId: string;
  columns: KbColumn[];
  rows: KbRow[];
  canEdit: boolean;
  filter?: KbGridFilter;
  sort?: KbGridSort;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<Record<string, Record<string, string>>>(() => {
    const m: Record<string, Record<string, string>> = {};
    for (const r of rows) m[r.id] = { ...r.values };
    return m;
  });
  const [adding, setAdding] = useState(false);
  const [newColName, setNewColName] = useState('');
  const [newColType, setNewColType] = useState<KbColumnType>('TEXT');

  // Filter/sort applied at render over LOCAL values (so just-saved edits are
  // reflected and nothing remounts). Editing always targets the real row id.
  const displayRows = useMemo(() => {
    let r = rows;
    if (filter?.colId && filter.text.trim()) {
      const q = filter.text.trim().toLowerCase();
      r = r.filter((row) => (values[row.id]?.[filter.colId] ?? '').toLowerCase().includes(q));
    }
    if (sort?.colId) {
      const col = columns.find((c) => c.id === sort.colId);
      r = [...r].sort((a, b) => {
        const av = values[a.id]?.[sort.colId] ?? '';
        const bv = values[b.id]?.[sort.colId] ?? '';
        const cmp = col?.type === 'NUMBER' ? (parseFloat(av) || 0) - (parseFloat(bv) || 0) : av.localeCompare(bv, 'ru');
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return r;
  }, [rows, values, filter, sort, columns]);

  function setCell(rowId: string, colId: string, value: string) {
    setValues((v) => ({ ...v, [rowId]: { ...(v[rowId] ?? {}), [colId]: value } }));
    startTransition(async () => {
      const res = await updateCellAction(rowId, colId, value);
      if (!res.ok) alert(res.error.message);
    });
  }

  function addColumn() {
    const name = newColName.trim() || TYPE_LABELS[newColType];
    let options: string[] | undefined;
    if (newColType === 'SELECT') {
      const raw = prompt('Варианты списка через запятую', 'Вариант 1, Вариант 2');
      options = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    }
    startTransition(async () => {
      const res = await addColumnAction(tableId, name, newColType, options);
      if (res.ok) {
        setAdding(false);
        setNewColName('');
        setNewColType('TEXT');
        router.refresh();
      } else alert(res.error.message);
    });
  }

  function renameColumn(col: KbColumn) {
    const name = prompt('Название столбца', col.name);
    if (name === null) return;
    startTransition(async () => {
      const res = await updateColumnAction(col.id, { name });
      if (res.ok) router.refresh();
      else alert(res.error.message);
    });
  }

  function editOptions(col: KbColumn) {
    const raw = prompt('Варианты списка через запятую', (col.options ?? []).join(', '));
    if (raw === null) return;
    const options = raw.split(',').map((s) => s.trim()).filter(Boolean);
    startTransition(async () => {
      const res = await updateColumnAction(col.id, { options });
      if (res.ok) router.refresh();
      else alert(res.error.message);
    });
  }

  function removeColumn(col: KbColumn) {
    if (!confirm(`Удалить столбец «${col.name}»?`)) return;
    startTransition(async () => {
      const res = await deleteColumnAction(col.id);
      if (res.ok) router.refresh();
      else alert(res.error.message);
    });
  }

  function addRow() {
    startTransition(async () => {
      const res = await addRowAction(tableId);
      if (res.ok) router.refresh();
      else alert(res.error.message);
    });
  }

  function removeRow(rowId: string) {
    startTransition(async () => {
      const res = await deleteRowAction(rowId);
      if (res.ok) router.refresh();
      else alert(res.error.message);
    });
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.id}
                scope="col"
                className="group min-w-[140px] border border-neutral-300 bg-muted px-2 py-1.5 text-left font-semibold dark:border-neutral-700"
              >
                <div className="flex items-center justify-between gap-1">
                  <button
                    type="button"
                    onClick={() => canEdit && renameColumn(col)}
                    className="min-w-0 flex-1 truncate text-left"
                    title={`${col.name} · ${TYPE_LABELS[col.type]}`}
                  >
                    {col.name}
                    <span className="ml-1 text-[10px] font-normal text-muted-foreground">{TYPE_LABELS[col.type]}</span>
                  </button>
                  {canEdit ? (
                    <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                      {col.type === 'SELECT' ? (
                        <button type="button" onClick={() => editOptions(col)} className="rounded px-1 text-xs text-muted-foreground hover:text-foreground" title="Варианты">
                          ⋯
                        </button>
                      ) : null}
                      <button type="button" onClick={() => removeColumn(col)} className="rounded text-muted-foreground hover:text-red-600" title="Удалить столбец">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ) : null}
                </div>
              </th>
            ))}
            {canEdit ? (
              <th scope="col" className="border border-neutral-300 bg-muted px-2 py-1.5 dark:border-neutral-700">
                {adding ? (
                  <div className="flex items-center gap-1">
                    <input
                      value={newColName}
                      onChange={(e) => setNewColName(e.target.value)}
                      placeholder="Название"
                      className="w-24 rounded border border-neutral-300 px-1 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                    />
                    <select
                      value={newColType}
                      onChange={(e) => setNewColType(e.target.value as KbColumnType)}
                      className="rounded border border-neutral-300 px-1 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                    >
                      {(Object.keys(TYPE_LABELS) as KbColumnType[]).map((t) => (
                        <option key={t} value={t}>
                          {TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                    <button type="button" onClick={addColumn} disabled={pending} className="rounded bg-neutral-900 px-1.5 py-0.5 text-xs text-white dark:bg-white dark:text-neutral-900">
                      ОК
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    <Plus className="h-3.5 w-3.5" /> Столбец
                  </button>
                )}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row, rowIndex) => (
            <tr key={row.id} className="group">
              {columns.map((col) => (
                <td key={col.id} className="border border-neutral-300 p-0 align-top dark:border-neutral-700">
                  <Cell
                    type={col.type}
                    options={col.options}
                    value={values[row.id]?.[col.id] ?? ''}
                    label={`${col.name}, строка ${rowIndex + 1}`}
                    disabled={!canEdit || pending}
                    onCommit={(v) => setCell(row.id, col.id, v)}
                  />
                </td>
              ))}
              {canEdit ? (
                <td className="border border-neutral-300 px-1 text-center align-middle dark:border-neutral-700">
                  <button type="button" onClick={() => removeRow(row.id)} className="text-muted-foreground opacity-0 transition hover:text-red-600 group-hover:opacity-100" title="Удалить строку">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
          {displayRows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 1} className="border border-neutral-300 px-2 py-3 text-center text-xs text-muted-foreground dark:border-neutral-700">
                {rows.length === 0 ? 'Нет строк.' : 'Ничего не найдено.'}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      {canEdit ? (
        <button type="button" onClick={addRow} disabled={pending} className="mt-2 flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
          <Plus className="h-3.5 w-3.5" /> Строка
        </button>
      ) : null}
    </div>
  );
}

function Cell({
  type,
  options,
  value,
  label,
  disabled,
  onCommit,
}: {
  type: KbColumnType;
  options: string[] | null;
  value: string;
  label: string;
  disabled: boolean;
  onCommit: (value: string) => void;
}) {
  const base = 'w-full bg-transparent px-2 py-1.5 text-sm outline-none focus:bg-muted/50 disabled:opacity-100';

  if (type === 'CHECKBOX') {
    return (
      <div className="flex items-center justify-center py-1.5">
        <input
          type="checkbox"
          aria-label={label}
          checked={value === 'true'}
          disabled={disabled}
          onChange={(e) => onCommit(e.target.checked ? 'true' : 'false')}
        />
      </div>
    );
  }
  if (type === 'SELECT') {
    return (
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onCommit(e.target.value)}
        className={base}
      >
        <option value="">—</option>
        {(options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  const inputType = type === 'NUMBER' ? 'number' : type === 'DATE' ? 'date' : type === 'URL' ? 'url' : 'text';
  return (
    <input
      type={inputType}
      aria-label={label}
      defaultValue={value}
      disabled={disabled}
      onBlur={(e) => {
        if (e.target.value !== value) onCommit(e.target.value);
      }}
      className={base}
    />
  );
}
