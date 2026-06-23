import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { requireAuth } from '@/lib/auth';
import { getArticle, listArticleVersions } from '@/lib/knowledge/getKnowledge';
import { getSpaceAccessById } from '@/lib/knowledge/access';
import { KbVersionHistory } from '@/components/domain/knowledge/KbVersionHistory';

export default async function KnowledgeArticleHistoryPage({
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

  const versions = await listArticleVersions(articleId);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link
          href={`/knowledge/${articleId}`}
          className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> К статье
        </Link>
        <h1 className="text-2xl font-bold">История изменений</h1>
        <p className="text-sm text-muted-foreground">{article.title}</p>
      </div>

      <KbVersionHistory
        articleId={articleId}
        versions={versions.map((v) => ({
          id: v.id,
          title: v.title,
          content: v.content,
          editorName: v.editorName,
          createdAt: v.createdAt.toISOString(),
        }))}
        canEdit={access.canEdit}
      />
    </div>
  );
}
