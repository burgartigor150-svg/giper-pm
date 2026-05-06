'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { cn } from '@giper/ui/cn';
import { Input } from '@giper/ui/components/Input';
import { useT } from '@/lib/useT';

const RANGES = ['today', 'week', 'month', 'custom'] as const;

type Props = {
  range: (typeof RANGES)[number];
  from?: string;
  to?: string;
};

export function TimeRangeTabs({ range, from, to }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const t = useT('time.range');
  const [pending, startTransition] = useTransition();

  function setRange(next: (typeof RANGES)[number]) {
    const sp = new URLSearchParams(params.toString());
    sp.set('range', next);
    if (next !== 'custom') {
      sp.delete('from');
      sp.delete('to');
    }
    startTransition(() => router.push(`?${sp.toString()}`));
  }

  function setCustom(field: 'from' | 'to', value: string) {
    const sp = new URLSearchParams(params.toString());
    sp.set('range', 'custom');
    if (value) sp.set(field, value);
    else sp.delete(field);
    startTransition(() => router.push(`?${sp.toString()}`));
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', pending && 'opacity-60')}>
      <div className="inline-flex overflow-hidden rounded-md border border-border">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={cn(
              'px-3 py-1 text-sm transition-colors',
              range === r ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
            )}
          >
            {t(r)}
          </button>
        ))}
      </div>
      {range === 'custom' ? (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={from ?? ''}
            onChange={(e) => setCustom('from', e.target.value)}
            className="h-8 w-auto"
          />
          <span className="text-muted-foreground">→</span>
          <Input
            type="date"
            value={to ?? ''}
            onChange={(e) => setCustom('to', e.target.value)}
            className="h-8 w-auto"
          />
        </div>
      ) : null}
    </div>
  );
}
