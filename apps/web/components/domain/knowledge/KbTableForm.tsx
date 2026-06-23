'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Plus } from 'lucide-react';
import { addRowAction, updateCellAction } from '@/actions/knowledgeTables';
import type { KbColumn } from '@/lib/knowledge/getTables';
import type { KbRelationMap } from '@/lib/knowledge/tableCompute';

/**
 * Form view (TEAMLY «форма»): a single-record entry form. Fields are the table's
 * columns minus FORMULA (computed). Submit creates a row, then fills each
 * non-empty cell. After save the form resets so it can collect the next entry.
 */
export function KbTableForm({
  tableId,
  columns,
  rowCount,
  relations,
  canEdit,
}: {
  tableId: string;
  columns: KbColumn[];
  rowCount: number;
  relations: KbRelationMap;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [savedAt, setSavedAt] = useState(0);

  const fields = columns.filter((c) => c.type !== 'FORMULA');

  if (!canEdit) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-muted-foreground dark:border-neutral-700">
        Для добавления записей через форму нужны права на редактирование.
      </p>
    );
  }

  function set(colId: string, value: string) {
    setDraft((d) => ({ ...d, [colId]: value }));
  }

  function submit() {
    startTransition(async () => {
      const res = await addRowAction(tableId);
      if (!res.ok) { alert(res.error.message); return; }
      const rowId = res.data!.id;
      const entries = Object.entries(draft).filter(([, v]) => v !== '' && v !== undefined);
      for (const [colId, v] of entries) {
        const r = await updateCellAction(rowId, colId, v);
        if (!r.ok) { alert(r.error.message); return; }
      }
      setDraft({});
      setSavedAt((n) => n + 1);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto w-full max-w-xl">
      <div className="rounded-xl border border-neutral-200 bg-background p-5 shadow-sm dark:border-neutral-800">
        <div className="flex flex-col gap-4">
          {fields.map((col) => (
            <label key={col.id} className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">{col.name}</span>
              <Field col={col} value={draft[col.id] ?? ''} relations={relations} onChange={(v) => set(col.id, v)} />
            </label>
          ))}
        </div>
        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            <Plus className="h-4 w-4" /> Добавить запись
          </button>
          {savedAt > 0 ? (
            <span key={savedAt} className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" /> Запись добавлена
            </span>
          ) : null}
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground">Всего записей: {rowCount}</p>
    </div>
  );
}

function Field({
  col,
  value,
  relations,
  onChange,
}: {
  col: KbColumn;
  value: string;
  relations: KbRelationMap;
  onChange: (value: string) => void;
}) {
  const base =
    'rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900';

  if (col.type === 'CHECKBOX') {
    return (
      <input type="checkbox" checked={value === 'true'} onChange={(e) => onChange(e.target.checked ? 'true' : 'false')} className="h-4 w-4" />
    );
  }
  if (col.type === 'SELECT') {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={base}>
        <option value="">—</option>
        {(col.options ?? []).map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    );
  }
  if (col.type === 'RELATION') {
    const opts = (col.relationTableId && relations[col.relationTableId]) || [];
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={base}>
        <option value="">—</option>
        {opts.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    );
  }
  const inputType = col.type === 'NUMBER' ? 'number' : col.type === 'DATE' ? 'date' : col.type === 'URL' ? 'url' : 'text';
  return <input type={inputType} value={value} onChange={(e) => onChange(e.target.value)} className={base} />;
}
