'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@giper/ui/components/Button';
import { useT } from '@/lib/useT';

type Props = {
  page: number;
  pageCount: number;
};

export function Pagination({ page, pageCount }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const t = useT('tasks.list');

  function go(targetPage: number) {
    const next = new URLSearchParams(params.toString());
    if (targetPage <= 1) next.delete('page');
    else next.set('page', String(targetPage));
    router.push(`?${next.toString()}`);
  }

  if (pageCount <= 1) return null;

  return (
    <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-2">
      <div className="text-xs text-muted-foreground">
        {t('page', { page, pageCount })}
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => go(page - 1)}>
          {t('prev')}
        </Button>
        <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => go(page + 1)}>
          {t('next')}
        </Button>
      </div>
    </div>
  );
}
