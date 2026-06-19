'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Play, Square, Trash2, Plus, Pencil } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import {
  createSprintAction,
  startSprintAction,
  closeSprintAction,
  deleteSprintAction,
  updateSprintAction,
} from '@/actions/sprints';
import type { SprintView, SprintStatusValue } from '@/lib/sprints/getSprints';

const STATUS_LABEL: Record<SprintStatusValue, string> = {
  ACTIVE: 'Активный',
  PLANNED: 'Запланирован',
  CLOSED: 'Закрыт',
};
const STATUS_CLASS: Record<SprintStatusValue, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  PLANNED: 'bg-sky-100 text-sky-700',
  CLOSED: 'bg-muted text-muted-foreground',
};

type Props = { projectKey: string; initial: SprintView[]; canManage: boolean };

export function SprintsForm({ projectKey, initial, canManage }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  // Inline edit of an existing sprint.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [eName, setEName] = useState('');
  const [eGoal, setEGoal] = useState('');
  const [eStart, setEStart] = useState('');
  const [eEnd, setEEnd] = useState('');

  function startEdit(s: SprintView) {
    setError(null);
    setEditingId(s.id);
    setEName(s.name);
    setEGoal(s.goal ?? '');
    setEStart(s.startDate ?? '');
    setEEnd(s.endDate ?? '');
  }

  function saveEdit(s: SprintView) {
    if (eName.trim().length < 2) {
      setError('Название ≥ 2 символов');
      return;
    }
    run(async () => {
      const res = await updateSprintAction(s.id, {
        name: eName.trim(),
        goal: eGoal.trim() || undefined,
        startDate: eStart || undefined,
        endDate: eEnd || undefined,
      });
      if (res.ok) setEditingId(null);
      return res;
    });
  }

  function run(fn: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) router.refresh();
      else setError(res.error?.message ?? 'Ошибка');
    });
  }

  function create() {
    if (name.trim().length < 2) {
      setError('Название ≥ 2 символов');
      return;
    }
    run(async () => {
      const res = await createSprintAction(projectKey, {
        name: name.trim(),
        goal: goal.trim() || undefined,
        startDate: start || undefined,
        endDate: end || undefined,
      });
      if (res.ok) {
        setName('');
        setGoal('');
        setStart('');
        setEnd('');
      }
      return res;
    });
  }

  function close(s: SprintView) {
    if (!confirm('Закрыть спринт? Незавершённые карточки перенесутся в следующий запланированный спринт (или в бэклог).')) return;
    run(() => closeSprintAction(s.id));
  }

  function remove(s: SprintView) {
    if (!confirm('Удалить спринт? Его карточки вернутся в бэклог (не удалятся).')) return;
    run(() => deleteSprintAction(s.id));
  }

  return (
    <div className="flex flex-col gap-4">
      {initial.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {initial.map((s) => (
            <li key={s.id} className="rounded-md border border-input bg-background p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_CLASS[s.status]}`}>
                  {STATUS_LABEL[s.status]}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {s.taskCount} зад.{s.startDate ? ` · ${s.startDate}${s.endDate ? `—${s.endDate}` : ''}` : ''}
                </span>
                {canManage ? (
                  <span className="flex shrink-0 items-center gap-1">
                    {s.status === 'PLANNED' ? (
                      <button
                        type="button"
                        title="Старт"
                        onClick={() => run(() => startSprintAction(s.id))}
                        disabled={pending}
                        className="rounded p-1 text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        <Play className="h-4 w-4" />
                      </button>
                    ) : null}
                    {s.status === 'ACTIVE' ? (
                      <button
                        type="button"
                        title="Закрыть"
                        onClick={() => close(s)}
                        disabled={pending}
                        className="rounded p-1 text-amber-600 hover:bg-amber-50 disabled:opacity-50"
                      >
                        <Square className="h-4 w-4" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      title="Редактировать"
                      onClick={() => startEdit(s)}
                      disabled={pending}
                      className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-50"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      title="Удалить"
                      onClick={() => remove(s)}
                      disabled={pending}
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </span>
                ) : null}
              </div>
              {s.goal && editingId !== s.id ? (
                <p className="mt-1 text-xs text-muted-foreground">{s.goal}</p>
              ) : null}
              {editingId === s.id ? (
                <div className="mt-2 flex flex-col gap-2 rounded-md border border-dashed p-2">
                  <input
                    value={eName}
                    onChange={(e) => setEName(e.target.value)}
                    disabled={pending}
                    maxLength={120}
                    placeholder="Название спринта"
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  />
                  <div className="flex flex-wrap gap-2">
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      с
                      <input
                        type="date"
                        value={eStart}
                        onChange={(e) => setEStart(e.target.value)}
                        disabled={pending}
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                      />
                    </label>
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      по
                      <input
                        type="date"
                        value={eEnd}
                        onChange={(e) => setEEnd(e.target.value)}
                        disabled={pending}
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                      />
                    </label>
                  </div>
                  <input
                    value={eGoal}
                    onChange={(e) => setEGoal(e.target.value)}
                    disabled={pending}
                    maxLength={2000}
                    placeholder="Цель спринта (необязательно)"
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => saveEdit(s)}
                      disabled={pending || eName.trim() === ''}
                    >
                      {pending ? 'Сохраняю…' : 'Сохранить'}
                    </Button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      disabled={pending}
                      className="rounded-md border border-input px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Спринтов пока нет.</p>
      )}

      {canManage ? (
        <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
          <div className="flex flex-wrap gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={pending}
              maxLength={120}
              placeholder="Название спринта"
              className="h-9 min-w-[10rem] flex-1 rounded-md border border-input bg-background px-2 text-sm"
            />
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              с
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} disabled={pending}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm" />
            </label>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              по
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} disabled={pending}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm" />
            </label>
          </div>
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            disabled={pending}
            maxLength={2000}
            placeholder="Цель спринта (необязательно)"
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          />
          <div className="flex items-center gap-3">
            <Button type="button" size="sm" onClick={create} disabled={pending || name.trim() === ''}>
              <Plus className="mr-1 h-4 w-4" />
              {pending ? 'Сохраняю…' : 'Создать спринт'}
            </Button>
            {error ? <span className="text-xs text-destructive">{error}</span> : null}
          </div>
        </div>
      ) : error ? (
        <span className="text-xs text-destructive">{error}</span>
      ) : null}
    </div>
  );
}
