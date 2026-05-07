'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

const PERIODS: { value: '7d' | '30d' | '12w' | 'custom'; label: string }[] = [
  { value: '7d', label: '7 дней' },
  { value: '30d', label: '30 дней' },
  { value: '12w', label: '12 недель' },
  { value: 'custom', label: 'Период' },
];

type Project = { key: string; name: string };
type Member = { id: string; name: string };

type Props = {
  projects: Project[];
  members?: Member[]; // PM/ADMIN only — see-other-people select
};

/**
 * URL-driven filter bar at the top of /reports. Each section reads the
 * same params on the server, so changing the period reloads the entire
 * report from a single source of truth.
 *
 * Submission strategy: every change patches the URL via router.push and
 * lets RSC re-render. We use startTransition so the page stays
 * interactive while sections refetch.
 */
export function ReportsFilterBar({ projects, members }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  const period = (sp.get('period') ?? '30d') as '7d' | '30d' | '12w' | 'custom';
  const projectKey = sp.get('projectKey') ?? '';
  const userId = sp.get('userId') ?? '';
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';

  function patch(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === '') params.delete(k);
      else params.set(k, v);
    }
    startTransition(() => router.push(`?${params.toString()}`));
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Период</span>
        <div className="flex gap-1 rounded-md border border-input bg-background p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => patch({ period: p.value })}
              disabled={pending}
              className={
                'rounded px-2 py-1 text-xs ' +
                (period === p.value
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-accent')
              }
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {period === 'custom' ? (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">С</span>
            <input
              type="date"
              value={from}
              onChange={(e) => patch({ from: e.target.value })}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">По</span>
            <input
              type="date"
              value={to}
              onChange={(e) => patch({ to: e.target.value })}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            />
          </label>
        </>
      ) : null}

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Проект</span>
        <select
          value={projectKey}
          onChange={(e) => patch({ projectKey: e.target.value || undefined })}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          disabled={pending}
        >
          <option value="">Все проекты</option>
          {projects.map((p) => (
            <option key={p.key} value={p.key}>
              {p.key} · {p.name}
            </option>
          ))}
        </select>
      </label>

      {members && members.length > 0 ? (
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Участник</span>
          <select
            value={userId}
            onChange={(e) => patch({ userId: e.target.value || undefined })}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            disabled={pending}
          >
            <option value="">Все</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
