import { prisma } from '@giper/db';

/** Total deduped views (unique reader-days) for one article. */
export async function getArticleViewCount(articleId: string): Promise<number> {
  return prisma.knowledgeArticleView.count({ where: { articleId } });
}

export type SpaceAnalytics = {
  totalViews: number;
  topArticles: { id: string; title: string; views: number }[];
  last7Days: { day: string; count: number }[];
};

/** View analytics for a space: total, top articles, and a 7-day series. */
export async function getSpaceAnalytics(spaceId: string): Promise<SpaceAnalytics> {
  const articles = await prisma.knowledgeArticle.findMany({
    where: { spaceId },
    select: { id: true, title: true },
  });
  const ids = articles.map((a) => a.id);
  const titleById = new Map(articles.map((a) => [a.id, a.title]));
  if (ids.length === 0) return { totalViews: 0, topArticles: [], last7Days: last7Skeleton() };

  const [total, byArticle, byDay] = await Promise.all([
    prisma.knowledgeArticleView.count({ where: { articleId: { in: ids } } }),
    prisma.knowledgeArticleView.groupBy({
      by: ['articleId'],
      where: { articleId: { in: ids } },
      _count: { _all: true },
      orderBy: { _count: { articleId: 'desc' } },
      take: 5,
    }),
    prisma.knowledgeArticleView.groupBy({
      by: ['day'],
      where: { articleId: { in: ids }, day: { in: last7Days() } },
      _count: { _all: true },
    }),
  ]);

  const dayCount = new Map(byDay.map((d) => [d.day, d._count._all]));
  return {
    totalViews: total,
    topArticles: byArticle.map((g) => ({
      id: g.articleId,
      title: titleById.get(g.articleId) ?? 'Без названия',
      views: g._count._all,
    })),
    last7Days: last7Days().map((day) => ({ day, count: dayCount.get(day) ?? 0 })),
  };
}

function last7Days(): string[] {
  const out: string[] = [];
  const now = Date.now();
  for (let i = 6; i >= 0; i--) {
    out.push(new Date(now - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}
function last7Skeleton() {
  return last7Days().map((day) => ({ day, count: 0 }));
}
