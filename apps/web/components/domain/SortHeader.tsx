'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

type Props = {
  field: string;
  label: string;
  currentField: string;
  currentDir: 'asc' | 'desc';
  /** Visual alignment of the header label/icon (matches the cell
   *  alignment below for numeric columns). */
  align?: 'left' | 'right';
};

/**
 * Sortable table header. The button toggles sort direction and writes
 * it into the URL (?sort=&dir=); pagination is reset. Pairs with
 * `aria-sort` on the parent <th> in the page so screen readers
 * announce the current sort state.
 *
 * - `scroll: false` keeps the user's scroll position when the new
 *   sorted page server-renders (MASTER §11 anti-pattern: auto-refresh
 *   that loses scroll).
 * - Focus-visible ring on the button so keyboard users see where they
 *   are (MASTER §7).
 */
export function SortHeader({ field, label, currentField, currentDir, align = 'left' }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const isActive = currentField === field;
  const Icon = !isActive ? ArrowUpDown : currentDir === 'asc' ? ArrowUp : ArrowDown;
  const stateLabel = !isActive
    ? `сортировать по «${label}»`
    : currentDir === 'asc'
      ? `«${label}», по возрастанию — нажмите для убывания`
      : `«${label}», по убыванию — нажмите для возрастания`;

  function toggle() {
    const nextDir = isActive && currentDir === 'asc' ? 'desc' : 'asc';
    const next = new URLSearchParams(params.toString());
    next.set('sort', field);
    next.set('dir', nextDir);
    next.delete('page');
    startTransition(() => router.push(`?${next.toString()}`, { scroll: false }));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={stateLabel}
      aria-busy={pending}
      className={`inline-flex w-full items-center gap-1 rounded text-xs font-medium uppercase tracking-wide transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        align === 'right' ? 'justify-end' : 'justify-start'
      } ${isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'} ${pending ? 'opacity-60' : ''}`}
    >
      {label}
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
    </button>
  );
}
