'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronUp, ChevronDown, Trash2, Plus } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import {
  updateCardTemplatesAction,
  type CardTemplateInput,
} from '@/actions/cardTemplates';
import type { CardTemplateView } from '@/lib/board/getCardTemplates';

const TYPE_LABELS: Record<CardTemplateView['type'], string> = {
  TASK: 'Задача',
  BUG: 'Баг',
  FEATURE: 'Фича',
  EPIC: 'Эпик',
  CHORE: 'Рутина',
};
const PRIORITY_LABELS: Record<CardTemplateView['priority'], string> = {
  LOW: 'Низкий',
  MEDIUM: 'Средний',
  HIGH: 'Высокий',
  URGENT: 'Срочный',
};
const TYPES = Object.keys(TYPE_LABELS) as CardTemplateView['type'][];
const PRIORITIES = Object.keys(PRIORITY_LABELS) as CardTemplateView['priority'][];

type Row = {
  id: string | null;
  name: string;
  title: string;
  description: string;
  type: CardTemplateView['type'];
  priority: CardTemplateView['priority'];
};

type Props = { projectId: string; initial: CardTemplateView[] };

/**
 * Manage a project's reusable card templates: name, default title/type/
 * priority, optional description. Saving reconciles the full set.
 */
export function CardTemplatesForm({ projectId, initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>(() =>
    [...initial]
      .sort((a, b) => a.order - b.order)
      .map((tpl) => ({
        id: tpl.id,
        name: tpl.name,
        title: tpl.title,
        description: tpl.description,
        type: tpl.type,
        priority: tpl.priority,
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
      setError('У каждого шаблона должно быть название');
      return;
    }
    startTransition(async () => {
      const templates: CardTemplateInput[] = rows.map((r) => ({
        id: r.id,
        name: r.name.trim(),
        title: r.title.trim(),
        description: r.description,
        type: r.type,
        priority: r.priority,
      }));
      const res = await updateCardTemplatesAction(projectId, templates);
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
        Шаблоны карточек: заготовка названия, типа и приоритета.
        Создать задачу из шаблона можно с доски проекта.
      </p>
      {rows.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {rows.map((r, i) => (
            <li
              key={r.id ?? `new-${i}`}
              className="flex flex-col gap-2 rounded-md border border-input bg-background p-2"
            >
              <div className="flex flex-wrap items-center gap-2">
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
                  maxLength={120}
                  placeholder="Название шаблона"
                  className="h-9 min-w-[8rem] flex-1 rounded-md border border-input bg-background px-2 text-sm"
                />
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
                <button
                  type="button"
                  aria-label="Удалить шаблон"
                  onClick={() => setRows((cur) => cur.filter((_, k) => k !== i))}
                  disabled={pending}
                  className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <input
                value={r.title}
                onChange={(e) => patch(i, { title: e.target.value })}
                disabled={pending}
                maxLength={200}
                placeholder="Название карточки по умолчанию (необязательно)"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Шаблонов пока нет.</p>
      )}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            setRows((cur) => [
              ...cur,
              { id: null, name: '', title: '', description: '', type: 'TASK', priority: 'MEDIUM' },
            ])
          }
          disabled={pending}
        >
          <Plus className="mr-1 h-4 w-4" />
          Добавить шаблон
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
