'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@giper/ui/components/Button';
import { setWipLimitsAction } from '@/actions/projects';

const COLUMNS = [
  { key: 'TODO', label: 'К работе' },
  { key: 'IN_PROGRESS', label: 'В работе' },
  { key: 'REVIEW', label: 'На ревью' },
  { key: 'BLOCKED', label: 'Заблокирована' },
] as const;

type Props = {
  projectId: string;
  /** Existing limits as stored on the project (status → number map). */
  initial: Record<string, number> | null;
};

/**
 * Form for editing per-status WIP limits. Soft limits — exceeding doesn't
 * block status changes, just paints the column header red on the kanban.
 *
 * We expose only the four "active work" columns by default; BACKLOG /
 * DONE / CANCELED don't sensibly take limits ("we shipped 200 things,
 * red?"). Empty input = no limit.
 */
export function WipLimitsForm({ projectId, initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const c of COLUMNS) {
      const v = initial?.[c.key];
      out[c.key] = v != null ? String(v) : '';
    }
    return out;
  });

  function save() {
    setSaved(false);
    startTransition(async () => {
      const limits: Record<string, number | null> = {};
      for (const c of COLUMNS) {
        const raw = values[c.key]?.trim() ?? '';
        if (raw === '') {
          limits[c.key] = null;
        } else {
          const n = Math.floor(Number(raw));
          if (Number.isFinite(n) && n > 0) limits[c.key] = n;
        }
      }
      const res = await setWipLimitsAction(projectId, limits);
      if (res.ok) {
        setSaved(true);
        router.refresh();
        setTimeout(() => setSaved(false), 1500);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Soft-limit на колонку канбана. Превышение подсвечивает заголовок красным,
        переходы статусов не блокируются. Пусто = без лимита.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {COLUMNS.map((c) => (
          <label key={c.key} className="flex items-center justify-between gap-3">
            <span className="text-sm">{c.label}</span>
            <input
              type="number"
              min={1}
              max={999}
              value={values[c.key]}
              onChange={(e) =>
                setValues((cur) => ({ ...cur, [c.key]: e.target.value }))
              }
              disabled={pending}
              placeholder="—"
              className="h-9 w-20 rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums"
            />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {pending ? 'Сохраняю…' : 'Сохранить'}
        </Button>
        {saved ? (
          <span className="text-xs text-emerald-600">Сохранено</span>
        ) : null}
      </div>
    </div>
  );
}
