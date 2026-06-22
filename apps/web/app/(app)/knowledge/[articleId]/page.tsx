import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { requireAuth } from '@/lib/auth';
import {
  getArticle,
  getArticleBreadcrumbs,
  isArticleFavorite,
} from '@/lib/knowledge/getKnowledge';
import { extractHeadings } from '@/lib/knowledge/renderMarkdown';
import { KbArticleEditor } from '@/components/domain/knowledge/KbArticleEditor';
import { KbToc } from '@/components/domain/knowledge/KbToc';

export default async function KnowledgeArticlePage({
  params,
}: {
  params: Promise<{ articleId: string }>;
}) {
  const { articleId } = await params;
  const me = await requireAuth();
  const article = await getArticle(articleId);
  if (!article) notFound();

  const [crumbs, favorite] = await Promise.all([
    getArticleBreadcrumbs(articleId),
    isArticleFavorite(me.id, articleId),
  ]);
  const canEdit = me.role !== 'VIEWER';
  const headings = extractHeadings(article.content);

  return (
    <div className="flex gap-8">
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <nav className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <Link href="/knowledge" className="hover:text-foreground">
            {article.space.icon ?? '📚'} {article.space.name}
          </Link>
          {crumbs.map((c, idx) => {
            const isLast = idx === crumbs.length - 1;
            return (
              <span key={c.id} className="flex items-center gap-1">
                <ChevronRight className="h-3 w-3" />
                {isLast ? (
                  <span className="text-foreground">{c.title}</span>
                ) : (
                  <Link href={`/knowledge/${c.id}`} className="hover:text-foreground">
                    {c.title}
                  </Link>
                )}
              </span>
            );
          })}
        </nav>

        <KbArticleEditor
          id={article.id}
          spaceId={article.spaceId}
          initialTitle={article.title}
          initialContent={article.content}
          initialIcon={article.icon}
          initialStatus={article.status}
          initialFavorite={favorite}
          canEdit={canEdit}
        />
      </div>

      <KbToc headings={headings} />
    </div>
  );
}
