'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Position } from '@giper/db';
import { setUserPositionsAction } from '@/actions/positions';

const POSITIONS: Position[] = [
  'FRONTEND', 'BACKEND', 'FULLSTACK', 'MOBILE',
  'QA', 'QA_AUTO',
  'DESIGNER', 'UX',
  'ANALYST', 'BA',
  'PM', 'LEAD',
  'DEVOPS', 'SRE',
  'CONTENT', 'MARKETING',
  'OTHER',
];

const POSITION_LABELS: Record<Position, string> = {
  FRONTEND: 'Frontend',
  BACKEND: 'Backend',
  FULLSTACK: 'Fullstack',
  MOBILE: 'Mobile',
  QA: 'QA',
  QA_AUTO: 'QA Auto',
  DESIGNER: 'Designer',
  UX: 'UX',
  ANALYST: 'Analyst',
  BA: 'Business Analyst',
  PM: 'PM',
  LEAD: 'Lead',
  DEVOPS: 'DevOps',
  SRE: 'SRE',
  CONTENT: 'Content',
  MARKETING: 'Marketing',
  OTHER: 'Other',
};

type Props = {
  userId: string;
  initial: { position: Position; primary: boolean }[];
};

/**
 * Editor for a user's specialty list. Multi-select via checkboxes
 * (one user can be Fullstack + DevOps), plus a radio for the primary
 * specialty (the headline shown in pickers next to the name).
 *
 * Permission: ADMIN-only — gate is enforced server-side by
 * setUserPositionsAction. We hide the save button if the actor isn't
 * admin via the parent page that already gates the route.
 */
export function UserPositionsForm({ userId, initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<Position>>(
    new Set(initial.map((p) => p.position)),
  );
  const [primary, setPrimary] = useState<Position | null>(
    initial.find((p) => p.primary)?.position ?? null,
  );
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(pos: Position) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(pos)) {
        next.delete(pos);
        if (primary === pos) setPrimary(null);
      } else {
        next.add(pos);
        if (primary === null) setPrimary(pos);
      }
      return next;
    });
  }

  function save() {
    setError(null);
    setSaved(false);
    const list = [...selected];
    startTransition(async () => {
      const res = await setUserPositionsAction(userId, list, primary);
      if (!res.ok) {
        setError(res.error.message);
      } else {
        setSaved(true);
        router.refresh();
        setTimeout(() => setSaved(false), 1500);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Должности участника. Можно несколько — например, Fullstack + DevOps.
        Primary показывается в подборщиках рядом с именем.
      </p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {POSITIONS.map((pos) => {
          const checked = selected.has(pos);
          const isPrimary = primary === pos;
          return (
            <label
              key={pos}
              className={
                'flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-sm transition-colors ' +
                (checked
                  ? 'border-blue-300 bg-blue-50'
                  : 'border-input hover:bg-accent')
              }
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(pos)}
                className="h-4 w-4 rounded border-input"
              />
              <span className="flex-1">{POSITION_LABELS[pos]}</span>
              {checked ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setPrimary(pos);
                  }}
                  className={
                    'text-[10px] uppercase tracking-wide ' +
                    (isPrimary
                      ? 'rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800'
                      : 'text-muted-foreground hover:text-foreground')
                  }
                  title="Сделать основной"
                >
                  {isPrimary ? '★ Основная' : 'основной'}
                </button>
              ) : null}
            </label>
          );
        })}
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background hover:opacity-90 disabled:opacity-50"
        >
          {pending ? 'Сохраняю…' : 'Сохранить должности'}
        </button>
        {saved ? <span className="text-xs text-emerald-600">Сохранено</span> : null}
      </div>
    </div>
  );
}
