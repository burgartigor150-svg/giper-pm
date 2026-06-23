import Link from 'next/link';
import { BarChart3, Eye } from 'lucide-react';
import type { SpaceAnalytics } from '@/lib/knowledge/getAnalytics';

/** Compact view analytics for a space (managers only): total + top + 7-day bars. */
export function KbSpaceAnalytics({ analytics }: { analytics: SpaceAnalytics }) {
  const max = Math.max(1, ...analytics.last7Days.map((d) => d.count));
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
          <BarChart3 className="h-4 w-4" /> Аналитика
        </h2>
        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
          <Eye className="h-4 w-4" /> {analytics.totalViews} просмотров
        </span>
      </div>

      <div>
        <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Просмотры за 7 дней</p>
        <div className="flex items-end gap-1" style={{ height: 56 }}>
          {analytics.last7Days.map((d) => (
            <div key={d.day} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${d.day}: ${d.count}`}>
              <div
                className="w-full rounded-t bg-blue-400/70 dark:bg-blue-500/60"
                style={{ height: `${Math.round((d.count / max) * 44)}px`, minHeight: d.count > 0 ? 3 : 0 }}
              />
              <span className="text-[9px] text-muted-foreground">{d.day.slice(8)}</span>
            </div>
          ))}
        </div>
      </div>

      {analytics.topArticles.length > 0 ? (
        <div>
          <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Популярные статьи</p>
          <ul className="flex flex-col gap-0.5">
            {analytics.topArticles.map((a) => (
              <li key={a.id} className="flex items-center gap-2 text-sm">
                <Link href={`/knowledge/${a.id}`} className="min-w-0 flex-1 truncate hover:underline">{a.title}</Link>
                <span className="shrink-0 text-xs text-muted-foreground">{a.views}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
