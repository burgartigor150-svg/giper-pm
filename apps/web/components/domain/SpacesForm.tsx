'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronUp, ChevronDown, Trash2, Plus, Check } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import {
  createSpaceAction,
  renameSpaceAction,
  deleteSpaceAction,
  reorderSpacesAction,
} from '@/actions/spaces';
import type { SpaceView } from '@/lib/spaces/getSpaces';

type Props = { initial: SpaceView[]; canManage: boolean };

export function SpacesForm({ initial, canManage }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  // Local editable names keyed by id.
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(initial.map((s) => [s.id, s.name])),
  );

  function run(fn: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) router.refresh();
      else setError(res.error?.message ?? 'Ошибка');
    });
  }

  function create() {
    if (newName.trim().length < 2) {
      setError('Название ≥ 2 символов');
      return;
    }
    run(async () => {
      const res = await createSpaceAction(newName.trim());
      if (res.ok) setNewName('');
      return res;
    });
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= initial.length) return;
    const ids = initial.map((s) => s.id);
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    run(() => reorderSpacesAction(ids));
  }

  if (!canManage) {
    return (
      <p className="text-sm text-muted-foreground">
        {initial.length > 0
          ? `Пространств: ${initial.length}. Управление — у ADMIN/PM.`
          : 'Пространств пока нет.'}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Пространства — папки для группировки проектов (как в Кайтене). Проект
        кладётся в пространство из его настроек. Видимость проектов не меняется.
      </p>
      {initial.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {initial.map((s, i) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-md border border-input bg-background p-2">
              <div className="flex shrink-0 flex-col">
                <button type="button" aria-label="Выше" onClick={() => move(i, -1)} disabled={pending || i === 0}
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30">
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button type="button" aria-label="Ниже" onClick={() => move(i, 1)} disabled={pending || i === initial.length - 1}
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30">
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
              <input
                value={names[s.id] ?? ''}
                onChange={(e) => setNames((n) => ({ ...n, [s.id]: e.target.value }))}
                disabled={pending}
                maxLength={120}
                className="h-9 min-w-[8rem] flex-1 rounded-md border border-input bg-background px-2 text-sm"
              />
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{s.projectCount} пр.</span>
              <button type="button" aria-label="Сохранить название" title="Сохранить"
                onClick={() => run(() => renameSpaceAction(s.id, names[s.id] ?? s.name, s.description ?? ''))}
                disabled={pending}
                className="shrink-0 rounded p-1.5 text-emerald-600 hover:bg-emerald-50 disabled:opacity-50">
                <Check className="h-4 w-4" />
              </button>
              <button type="button" aria-label="Удалить пространство" title="Удалить (проекты разгруппируются)"
                onClick={() => { if (confirm('Удалить пространство? Его проекты станут без пространства (не удалятся).')) run(() => deleteSpaceAction(s.id)); }}
                disabled={pending}
                className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50">
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Пространств пока нет.</p>
      )}
      <div className="flex items-center gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          disabled={pending}
          maxLength={120}
          placeholder="Новое пространство"
          className="h-9 min-w-[10rem] flex-1 rounded-md border border-input bg-background px-2 text-sm"
        />
        <Button type="button" size="sm" onClick={create} disabled={pending || newName.trim() === ''}>
          <Plus className="mr-1 h-4 w-4" />
          {pending ? '…' : 'Создать'}
        </Button>
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </div>
    </div>
  );
}
