import { notFound } from 'next/navigation';
import Link from 'next/link';
import { FileText } from 'lucide-react';
import { requireAuth } from '@/lib/auth';
import {
  getSpace,
  getSpaceArticles,
  isSpaceFavorite,
  listTemplatesForSpace,
} from '@/lib/knowledge/getKnowledge';
import { KbSpaceHeader } from '@/components/domain/knowledge/KbSpaceHeader';

export default async function KnowledgeSpacePage({
  params,
}: {
  params: Promise<{ spaceId: string }>;
}) {
  const { spaceId } = await params;
  const me = await requireAuth();
  const space = await getSpace(spaceId);
  if (!space) notFound();

  const [articles, favorite, templates] = await Promise.all([
    getSpaceArticles(spaceId),
    isSpaceFavorite(me.id, spaceId),
    listTemplatesForSpace(spaceId),
  ]);

  const canManage = me.role === 'ADMIN' || me.role === 'PM';
  const canEdit = me.role !== 'VIEWER';
  const topLevel = articles.filter((a) => a.parentId === null);
  // child count per parent, for "N подстатей" hints on the list
  const childCount = new Map<string, number>();
  for (const a of articles) {
    if (a.parentId) childCount.set(a.parentId, (childCount.get(a.parentId) ?? 0) + 1);
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <KbSpaceHeader
        spaceId={space.id}
        name={space.name}
        description={space.description}
        icon={space.icon}
        color={space.color}
        articleCount={space._count.articles}
        isFavorite={favorite}
        templates={templates}
        canManage={canManage}
        canEdit={canEdit}
      />

      {topLevel.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-sm text-muted-foreground dark:border-neutral-700">
          В этом пространстве пока нет статей.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {topLevel.map((a) => {
            const kids = childCount.get(a.id) ?? 0;
            return (
              <li key={a.id}>
                <Link href={`/knowledge/${a.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted">
                  <span className="shrink-0">{a.icon ?? <FileText className="h-4 w-4 text-muted-foreground" />}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.title}</span>
                  {a.status === 'DRAFT' ? (
                    <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                      черновик
                    </span>
                  ) : null}
                  {kids > 0 ? <span className="shrink-0 text-xs text-muted-foreground">{kids} подст.</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
