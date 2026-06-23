import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { requireAuth } from '@/lib/auth';
import {
  getArticle,
  getArticleBreadcrumbs,
  isArticleFavorite,
} from '@/lib/knowledge/getKnowledge';
import { getSpaceAccessById } from '@/lib/knowledge/access';
import { getArticleComments, getArticleReactions } from '@/lib/knowledge/getComments';
import { extractHeadings } from '@/lib/knowledge/renderMarkdown';
import { KbArticleEditor } from '@/components/domain/knowledge/KbArticleEditor';
import { KbToc } from '@/components/domain/knowledge/KbToc';
import { KbComments } from '@/components/domain/knowledge/KbComments';

export default async function KnowledgeArticlePage({
  params,
}: {
  params: Promise<{ articleId: string }>;
}) {
  const { articleId } = await params;
  const me = await requireAuth();
  const article = await getArticle(articleId);
  if (!article) notFound();

  const access = await getSpaceAccessById(me, article.spaceId);
  if (!access.canView) notFound();

  const [crumbs, favorite, comments, articleReactions] = await Promise.all([
    getArticleBreadcrumbs(articleId),
    isArticleFavorite(me.id, articleId),
    getArticleComments(articleId, me.id),
    getArticleReactions(articleId, me.id),
  ]);
  const canEdit = access.canEdit;
  const headings = extractHeadings(article.content);

  return (
    <div className="flex gap-8">
      <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-1 flex-col gap-5">
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
          key={article.id}
          id={article.id}
          spaceId={article.spaceId}
          initialTitle={article.title}
          initialContent={article.content}
          initialIcon={article.icon}
          initialStatus={article.status}
          initialFavorite={favorite}
          canEdit={canEdit}
        />

        <KbComments
          key={article.id}
          articleId={article.id}
          comments={comments}
          articleReactions={articleReactions}
          meId={me.id}
          canComment={access.canView}
          canManage={access.canManage}
        />
      </div>

      <KbToc key={article.id} headings={headings} />
    </div>
  );
}
