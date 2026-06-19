'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, Plus } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import {
  updateRecurringTasksAction,
  type RecurringTaskInput,
} from '@/actions/recurringTasks';
import type { RecurringTaskView } from '@/lib/board/getRecurringTasks';

const TYPE_LABELS: Record<RecurringTaskView['type'], string> = {
  TASK: 'Задача',
  BUG: 'Баг',
  FEATURE: 'Фича',
  EPIC: 'Эпик',
  CHORE: 'Рутина',
};
const PRIORITY_LABELS: Record<RecurringTaskView['priority'], string> = {
  LOW: 'Низкий',
  MEDIUM: 'Средний',
  HIGH: 'Высокий',
  URGENT: 'Срочный',
};
const TYPES = Object.keys(TYPE_LABELS) as RecurringTaskView['type'][];
const PRIORITIES = Object.keys(PRIORITY_LABELS) as RecurringTaskView['priority'][];

type Row = {
  id: string | null;
  title: string;
  type: RecurringTaskView['type'];
  priority: RecurringTaskView['priority'];
  intervalDays: string;
  startDate: string;
  active: boolean;
};

type Props = { projectId: string; initial: RecurringTaskView[] };

/** Default a new rule's start date to tomorrow (YYYY-MM-DD). */
function tomorrowISO(): string {
  const d = new Date(Date.now() + 24 * 3600_000);
  return d.toISOString().slice(0, 10);
}

/**
 * Manage a project's recurring cards: each rule auto-creates a card every
 * N days starting from a date. Saving reconciles the full set.
 */
export function RecurringTasksForm({ projectId, initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>(() =>
    initial.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      priority: r.priority,
      intervalDays: String(r.intervalDays),
      startDate: r.startDate,
      active: r.active,
    })),
  );

  function patch(i: number, p: Partial<Row>) {
    setRows((cur) => cur.map((r, k) => (k === i ? { ...r, ...p } : r)));
  }

  function save() {
    setSaved(false);
    setError(null);
    if (rows.some((r) => r.title.trim().length < 2)) {
      setError('У каждой карточки нужно название (≥2 символов)');
      return;
    }
    startTransition(async () => {
      const payload: RecurringTaskInput[] = rows.map((r) => ({
        id: r.id,
        title: r.title.trim(),
        type: r.type,
        priority: r.priority,
        intervalDays: Math.floor(Number(r.intervalDays)) || 1,
        startDate: r.startDate,
        active: r.active,
      }));
      const res = await updateRecurringTasksAction(projectId, payload);
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
        Повторяющиеся карточки: новая карточка создаётся каждые
        N дней начиная с указанной даты. Создаёт планировщик.
      </p>
      {rows.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {rows.map((r, i) => (
            <li
              key={r.id ?? `new-${i}`}
              className="flex flex-col gap-2 rounded-md border border-input bg-background p-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={r.title}
                  onChange={(e) => patch(i, { title: e.target.value })}
                  disabled={pending}
                  maxLength={200}
                  placeholder="Название карточки"
                  className="h-9 min-w-[10rem] flex-1 rounded-md border border-input bg-background px-2 text-sm"
                />
                <button
                  type="button"
                  aria-label="Удалить правило"
                  onClick={() => setRows((cur) => cur.filter((_, k) => k !== i))}
                  disabled={pending}
                  className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={r.type}
                  onChange={(e) => patch(i, { type: e.target.value as Row['type'] })}
                  disabled={pending}
                  aria-label="Тип"
                  className="h-9 shrink-0 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
                <select
                  value={r.priority}
                  onChange={(e) => patch(i, { priority: e.target.value as Row['priority'] })}
                  disabled={pending}
                  aria-label="Приоритет"
                  className="h-9 shrink-0 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABELS[p]}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  Каждые
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    value={r.intervalDays}
                    onChange={(e) => patch(i, { intervalDays: e.target.value })}
                    disabled={pending}
                    aria-label="Интервал в днях"
                    className="h-9 w-16 rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums"
                  />
                  дн.
                </label>
                <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  с
                  <input
                    type="date"
                    value={r.startDate}
                    onChange={(e) => patch(i, { startDate: e.target.value })}
                    disabled={pending}
                    aria-label="Дата старта"
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={r.active}
                    onChange={(e) => patch(i, { active: e.target.checked })}
                    disabled={pending}
                  />
                  Активно
                </label>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Повторяющихся карточек пока нет.</p>
      )}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            setRows((cur) => [
              ...cur,
              {
                id: null,
                title: '',
                type: 'TASK',
                priority: 'MEDIUM',
                intervalDays: '7',
                startDate: tomorrowISO(),
                active: true,
              },
            ])
          }
          disabled={pending}
        >
          <Plus className="mr-1 h-4 w-4" />
          Добавить правило
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
