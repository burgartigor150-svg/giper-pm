'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronUp, ChevronDown, Trash2, Plus } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import {
  updateCustomFieldsAction,
  type CustomFieldInput,
} from '@/actions/customFields';
import type { CustomFieldView } from '@/lib/board/getCustomFields';

type FieldType = CustomFieldView['type'];

const TYPE_LABELS: Record<FieldType, string> = {
  TEXT: 'Текст',
  NUMBER: 'Число',
  DATE: 'Дата',
  CHECKBOX: 'Флажок',
  SELECT: 'Список',
  MULTI_SELECT: 'Мультисписок',
  URL: 'Ссылка',
};
const TYPES = Object.keys(TYPE_LABELS) as FieldType[];

type Row = { id: string | null; name: string; type: FieldType; options: string };

type Props = { projectId: string; initial: CustomFieldView[] };

/**
 * Manage a project's custom field definitions: add, rename, pick a type, set
 * options (for list types), reorder, delete. Saving reconciles the full set.
 */
export function CustomFieldsForm({ projectId, initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>(() =>
    [...initial]
      .sort((a, b) => a.order - b.order)
      .map((f) => ({
        id: f.id,
        name: f.name,
        type: f.type,
        options: f.options.join(', '),
      })),
  );

  function patch(i: number, p: Partial<Row>) {
    setRows((cur) => cur.map((r, k) => (k === i ? { ...r, ...p } : r)));
  }
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
      setError('У каждого поля должно быть название');
      return;
    }
    startTransition(async () => {
      const fields: CustomFieldInput[] = rows.map((r, i) => ({
        id: r.id,
        name: r.name.trim(),
        type: r.type,
        options:
          r.type === 'SELECT' || r.type === 'MULTI_SELECT'
            ? r.options.split(',').map((o) => o.trim()).filter(Boolean)
            : [],
        order: i,
      }));
      const res = await updateCustomFieldsAction(projectId, fields);
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
        Произвольные поля задач проекта. Для списков укажите
        варианты через запятую. Значения заполняются в карточке задачи.
      </p>
      {rows.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {rows.map((r, i) => {
            const isChoice = r.type === 'SELECT' || r.type === 'MULTI_SELECT';
            return (
              <li
                key={r.id ?? `new-${i}`}
                className="flex flex-wrap items-center gap-2 rounded-md border border-input bg-background p-2"
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
                  onChange={(e) => patch(i, { name: e.target.value })}
                  disabled={pending}
                  maxLength={60}
                  placeholder="Название поля"
                  className="h-9 min-w-[8rem] flex-1 rounded-md border border-input bg-background px-2 text-sm"
                />
                <select
                  value={r.type}
                  onChange={(e) => patch(i, { type: e.target.value as FieldType })}
                  disabled={pending}
                  className="h-9 shrink-0 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
                {isChoice ? (
                  <input
                    value={r.options}
                    onChange={(e) => patch(i, { options: e.target.value })}
                    disabled={pending}
                    placeholder="вариант1, вариант2"
                    className="h-9 min-w-[10rem] flex-1 rounded-md border border-input bg-background px-2 text-sm"
                  />
                ) : null}
                <button
                  type="button"
                  aria-label="Удалить поле"
                  onClick={() => setRows((cur) => cur.filter((_, k) => k !== i))}
                  disabled={pending}
                  className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Полей пока нет.</p>
      )}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setRows((cur) => [...cur, { id: null, name: '', type: 'TEXT', options: '' }])}
          disabled={pending}
        >
          <Plus className="mr-1 h-4 w-4" />
          Добавить поле
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
