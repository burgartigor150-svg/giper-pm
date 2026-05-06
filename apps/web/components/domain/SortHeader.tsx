'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

type Props = {
  field: string;
  label: string;
  currentField: string;
  currentDir: 'asc' | 'desc';
};

export function SortHeader({ field, label, currentField, currentDir }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const isActive = currentField === field;
  const Icon = !isActive ? ArrowUpDown : currentDir === 'asc' ? ArrowUp : ArrowDown;

  function toggle() {
    const nextDir = isActive && currentDir === 'asc' ? 'desc' : 'asc';
    const next = new URLSearchParams(params.toString());
    next.set('sort', field);
    next.set('dir', nextDir);
    next.delete('page');
    startTransition(() => router.push(`?${next.toString()}`));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={`inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wide transition-colors ${
        isActive ? 'text-foreground' : 'text-muted-foreground'
      } ${pending ? 'opacity-60' : ''}`}
    >
      {label}
      <Icon className="h-3 w-3" />
    </button>
  );
}
