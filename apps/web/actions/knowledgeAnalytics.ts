'use server';

import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { getSpaceAccessById } from '@/lib/knowledge/access';

/**
 * Record an article view (deduped per user/day). Fire-and-forget from the
 * article page; only counts viewers who can actually see the space, so private
 * spaces don't get inflated by stray calls.
 */
export async function recordArticleViewAction(articleId: string): Promise<{ ok: boolean }> {
  const me = await requireAuth();
  const article = await prisma.knowledgeArticle.findUnique({
    where: { id: articleId },
    select: { spaceId: true },
  });
  if (!article) return { ok: false };
  const acc = await getSpaceAccessById(me, article.spaceId);
  if (!acc.canView) return { ok: false };

  const day = new Date().toISOString().slice(0, 10);
  await prisma.knowledgeArticleView.upsert({
    where: { articleId_userId_day: { articleId, userId: me.id, day } },
    update: {},
    create: { articleId, userId: me.id, day },
  });
  return { ok: true };
}
