import Link from 'next/link';
import { FileText } from 'lucide-react';
import { requireAuth } from '@/lib/auth';
import {
  listKnowledgeSpaces,
  searchKnowledge,
} from '@/lib/knowledge/getKnowledge';
import { KbSearchBar } from '@/components/domain/knowledge/KbSearchBar';

/**
 * Knowledge Base home: search + space cards. When ?q= is present, shows
 * matching articles instead of the space grid (SSR, debounced from the bar).
 */
export default async function KnowledgeHome({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const me = await requireAuth();
  const { q } = await searchParams;
  const query = (q ?? '').trim();
  const [spaces, results] = await Promise.all([
    listKnowledgeSpaces(me),
    query.length >= 2 ? searchKnowledge(query, me) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">База знаний</h1>
        <p className="text-sm text-muted-foreground">
          Единое пространство статей, инструкций и регламентов компании.
        </p>
      </header>

      <KbSearchBar initial={query} />

      {query.length >= 2 ? (
        <section className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Результаты по «{query}» — {results.length}
          </p>
          {results.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-muted-foreground dark:border-neutral-700">
              Ничего не найдено.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
              {results.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/knowledge/${r.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted"
                  >
                    <span className="shrink-0">
                      {r.icon ?? <FileText className="h-4 w-4 text-muted-foreground" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {r.space.icon ?? '📚'} {r.space.name}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section>
          {spaces.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-sm text-muted-foreground dark:border-neutral-700">
              Пространств пока нет. Создайте первое в боковой панели.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {spaces.map((sp) => {
                const first = sp._count.articles;
                return (
                  <Link
                    key={sp.id}
                    href={`/knowledge/space/${sp.id}`}
                    className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-4 transition hover:border-neutral-400 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-neutral-800 dark:hover:border-neutral-600"
                    style={sp.color ? { borderTopColor: sp.color, borderTopWidth: 3 } : undefined}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{sp.icon ?? '📚'}</span>
                      <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{sp.name}</h2>
                    </div>
                    {sp.description ? (
                      <p className="line-clamp-2 text-sm text-muted-foreground">{sp.description}</p>
                    ) : null}
                    <p className="mt-auto text-xs text-muted-foreground">{first} статей</p>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
