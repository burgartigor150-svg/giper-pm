'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';

/** Debounced KB search — reflects the query into the URL (?q=) for SSR results. */
export function KbSearchBar({ initial }: { initial: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);

  useEffect(() => {
    if (q === initial) return;
    const t = setTimeout(() => {
      const trimmed = q.trim();
      router.replace(trimmed ? `/knowledge?q=${encodeURIComponent(trimmed)}` : '/knowledge');
    }, 300);
    return () => clearTimeout(t);
  }, [q, initial, router]);

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Поиск по базе знаний…"
        className="w-full rounded-lg border border-neutral-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
      />
    </div>
  );
}
