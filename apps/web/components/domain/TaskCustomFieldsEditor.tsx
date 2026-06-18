'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setCustomFieldValueAction } from '@/actions/customFields';
import type { CustomFieldView } from '@/lib/board/getCustomFields';

type Props = {
  taskId: string;
  fields: CustomFieldView[];
  /** fieldId → stored value string. */
  values: Record<string, string>;
  canEdit: boolean;
};

/**
 * Per-task custom field value editor. One row per field; saves on blur (text
 * types) or change (choice/checkbox) via setCustomFieldValueAction. MULTI_SELECT
 * stores a JSON string array. Read-only when the user can't edit the task.
 */
export function TaskCustomFieldsEditor({ taskId, fields, values, canEdit }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [local, setLocal] = useState<Record<string, string>>(values);
  const [error, setError] = useState<string | null>(null);

  function persist(fieldId: string, value: string) {
    setError(null);
    startTransition(async () => {
      const res = await setCustomFieldValueAction(taskId, fieldId, value);
      if (res.ok) router.refresh();
      else {
        setError(res.error.message);
        setLocal((cur) => ({ ...cur, [fieldId]: values[fieldId] ?? '' })); // revert
      }
    });
  }

  function multiToggle(field: CustomFieldView, option: string, checked: boolean) {
    let arr: string[];
    try {
      arr = JSON.parse(local[field.id] || '[]');
      if (!Array.isArray(arr)) arr = [];
    } catch {
      arr = [];
    }
    const next = checked ? [...new Set([...arr, option])] : arr.filter((o) => o !== option);
    const value = JSON.stringify(next);
    setLocal((cur) => ({ ...cur, [field.id]: value }));
    persist(field.id, value);
  }

  return (
    <div className="flex flex-col gap-3">
      {fields.map((f) => {
        const v = local[f.id] ?? '';
        const base =
          'h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60';
        return (
          <label key={f.id} className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">{f.name}</span>
            {f.type === 'TEXT' || f.type === 'URL' ? (
              <input
                type={f.type === 'URL' ? 'url' : 'text'}
                value={v}
                disabled={!canEdit || pending}
                onChange={(e) => setLocal((c) => ({ ...c, [f.id]: e.target.value }))}
                onBlur={(e) => e.target.value !== (values[f.id] ?? '') && persist(f.id, e.target.value)}
                className={base}
              />
            ) : f.type === 'NUMBER' ? (
              <input
                type="number"
                value={v}
                disabled={!canEdit || pending}
                onChange={(e) => setLocal((c) => ({ ...c, [f.id]: e.target.value }))}
                onBlur={(e) => e.target.value !== (values[f.id] ?? '') && persist(f.id, e.target.value)}
                className={base}
              />
            ) : f.type === 'DATE' ? (
              <input
                type="date"
                value={v}
                disabled={!canEdit || pending}
                onChange={(e) => {
                  setLocal((c) => ({ ...c, [f.id]: e.target.value }));
                  persist(f.id, e.target.value);
                }}
                className={base}
              />
            ) : f.type === 'CHECKBOX' ? (
              <input
                type="checkbox"
                checked={v === 'true'}
                disabled={!canEdit || pending}
                onChange={(e) => {
                  const value = e.target.checked ? 'true' : 'false';
                  setLocal((c) => ({ ...c, [f.id]: value }));
                  persist(f.id, value);
                }}
                className="h-4 w-4"
              />
            ) : f.type === 'SELECT' ? (
              <select
                value={v}
                disabled={!canEdit || pending}
                onChange={(e) => {
                  setLocal((c) => ({ ...c, [f.id]: e.target.value }));
                  persist(f.id, e.target.value);
                }}
                className={base}
              >
                <option value="">—</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              // MULTI_SELECT
              <div className="flex flex-wrap gap-2">
                {f.options.map((o) => {
                  let arr: string[];
                  try {
                    arr = JSON.parse(v || '[]');
                    if (!Array.isArray(arr)) arr = [];
                  } catch {
                    arr = [];
                  }
                  return (
                    <label key={o} className="inline-flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={arr.includes(o)}
                        disabled={!canEdit || pending}
                        onChange={(e) => multiToggle(f, o, e.target.checked)}
                        className="h-3.5 w-3.5"
                      />
                      {o}
                    </label>
                  );
                })}
              </div>
            )}
          </label>
        );
      })}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
