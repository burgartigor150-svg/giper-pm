'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { cn } from '@giper/ui/cn';
import { useT } from '@/lib/useT';

type Props = {
  scope: 'mine' | 'all';
  status: 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'ARCHIVED' | undefined;
  includeArchived: boolean;
  showAllScope: boolean;
};

const STATUSES = ['ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'] as const;

export function ProjectFilters({ scope, status, includeArchived, showAllScope }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const t = useT('projects');

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    startTransition(() => {
      router.push(`/projects?${next.toString()}`);
    });
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-4', pending && 'opacity-60')}>
      {showAllScope ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('scope.label')}:</span>
          <div className="inline-flex overflow-hidden rounded-md border border-border">
            <button
              type="button"
              onClick={() => setParam('scope', 'mine')}
              className={cn(
                'px-3 py-1 text-xs',
                scope === 'mine' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
              )}
            >
              {t('scope.mine')}
            </button>
            <button
              type="button"
              onClick={() => setParam('scope', 'all')}
              className={cn(
                'px-3 py-1 text-xs',
                scope === 'all' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
              )}
            >
              {t('scope.all')}
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">{t('filter.status')}:</span>
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          value={status ?? ''}
          onChange={(e) => setParam('status', e.target.value || null)}
        >
          <option value="">{t('filter.any')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={includeArchived}
          onChange={(e) => setParam('archived', e.target.checked ? '1' : null)}
        />
        {t('filter.showArchived')}
      </label>
    </div>
  );
}
