'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Trash2, Check, X, Rocket } from 'lucide-react';
import { Input } from '@giper/ui/components/Input';
import { Button } from '@giper/ui/components/Button';
import {
  createVersionAction,
  updateVersionAction,
  setVersionStatusAction,
  deleteVersionAction,
} from '@/actions/versions';
import type { VersionRow } from '@/lib/versions/listVersionsForProject';

type Props = {
  projectKey: string;
  initial: VersionRow[];
  canManage: boolean;
};

const STATUS_LABEL: Record<VersionRow['status'], string> = {
  PLANNED: 'Планируется',
  RELEASED: 'Выпущена',
  ARCHIVED: 'В архиве',
};
const STATUS_CLASS: Record<VersionRow['status'], string> = {
  PLANNED: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  RELEASED: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  ARCHIVED: 'bg-muted text-muted-foreground',
};

function fmtDate(d: Date | string | null): string {
  if (!d) return '';
  // releaseDate is stored at UTC midnight; format in UTC so the shown day
  // matches the entered value regardless of the viewer's timezone.
  return new Date(d).toLocaleDateString('ru-RU', { timeZone: 'UTC' });
}

export function VersionsManager({ projectKey, initial, canManage }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDate, setEditDate] = useState('');

  function create() {
    setError(null);
    if (name.trim().length < 2) {
      setError('Название: минимум 2 символа');
      return;
    }
    startTransition(async () => {
      const res = await createVersionAction({ projectKey, name: name.trim(), releaseDate: date || null });
      if (res.ok) {
        setName('');
        setDate('');
        router.refresh();
      } else setError(res.error.message);
    });
  }

  function startEdit(v: VersionRow) {
    setEditId(v.id);
    setEditName(v.name);
    setEditDate(v.releaseDate ? new Date(v.releaseDate).toISOString().slice(0, 10) : '');
    setError(null);
  }

  function saveEdit(id: string) {
    startTransition(async () => {
      const res = await updateVersionAction(id, { name: editName.trim(), releaseDate: editDate || null });
      if (res.ok) {
        setEditId(null);
        router.refresh();
      } else setError(res.error.message);
    });
  }

  function changeStatus(id: string, status: VersionRow['status']) {
    startTransition(async () => {
      const res = await setVersionStatusAction(id, status);
      if (res.ok) router.refresh();
      else setError(res.error.message);
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteVersionAction(id);
      if (res.ok) router.refresh();
      else setError(res.error.message);
    });
  }

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="ver-name" className="text-xs font-medium text-muted-foreground">Название версии</label>
            <Input
              id="ver-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: 2.0 / Q3 Release"
              maxLength={80}
              className="h-9 w-56"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="ver-date" className="text-xs font-medium text-muted-foreground">Дата релиза</label>
            <Input id="ver-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 w-40" />
          </div>
          <Button onClick={create} disabled={pending}>Создать версию</Button>
        </div>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {initial.length === 0 ? (
        <p className="text-sm text-muted-foreground">Версий пока нет.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {initial.map((v) => {
            const pct = v.taskCount > 0 ? Math.round((v.doneCount / v.taskCount) * 100) : 0;
            const editing = editId === v.id;
            return (
              <li key={v.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  {editing ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={80} className="h-8 w-48" />
                      <Input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} className="h-8 w-40" />
                      <button type="button" onClick={() => saveEdit(v.id)} disabled={pending} className="rounded p-1 text-emerald-600 hover:bg-muted" aria-label="Сохранить">
                        <Check className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => setEditId(null)} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Отмена">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{v.name}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLASS[v.status]}`}>{STATUS_LABEL[v.status]}</span>
                      {v.releaseDate ? <span className="text-xs text-muted-foreground">→ {fmtDate(v.releaseDate)}</span> : null}
                    </div>
                  )}
                  {/* Progress */}
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {v.doneCount}/{v.taskCount} ({pct}%)
                    </span>
                  </div>
                </div>

                {canManage && !editing ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <select
                      value={v.status}
                      onChange={(e) => changeStatus(v.id, e.target.value as VersionRow['status'])}
                      disabled={pending}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                      aria-label="Статус версии"
                    >
                      <option value="PLANNED">Планируется</option>
                      <option value="RELEASED">Выпущена</option>
                      <option value="ARCHIVED">В архиве</option>
                    </select>
                    {v.status !== 'RELEASED' ? (
                      <button type="button" onClick={() => changeStatus(v.id, 'RELEASED')} disabled={pending} title="Выпустить" className="rounded p-1.5 text-emerald-600 hover:bg-muted">
                        <Rocket className="h-4 w-4" />
                      </button>
                    ) : null}
                    <button type="button" onClick={() => startEdit(v)} disabled={pending} title="Редактировать" className="rounded p-1.5 text-muted-foreground hover:bg-muted">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => remove(v.id)} disabled={pending} title="Удалить" className="rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-muted">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
