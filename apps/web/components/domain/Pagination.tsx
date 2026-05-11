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
    // scroll: false — pagination must NOT reset the user's scroll
    // position when the new page server-renders (MASTER §11
    // anti-pattern: auto-refresh that loses scroll).
    router.push(`?${next.toString()}`, { scroll: false });
  }

  if (pageCount <= 1) return null;

  return (
    <nav
      aria-label="Пагинация"
      className="flex items-center justify-between gap-4 border-t border-border px-4 py-2"
    >
      <div className="text-xs tabular-nums text-muted-foreground">
        {t('page', { page, pageCount })}
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => go(page - 1)}
          aria-label="Предыдущая страница"
        >
          {t('prev')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={page >= pageCount}
          onClick={() => go(page + 1)}
          aria-label="Следующая страница"
        >
          {t('next')}
        </Button>
      </div>
    </nav>
  );
}
