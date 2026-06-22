import { prisma } from '@giper/db';

/** All non-archived knowledge spaces, ordered, with article counts. */
export async function listKnowledgeSpaces() {
  return prisma.knowledgeSpace.findMany({
    where: { archivedAt: null },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      name: true,
      icon: true,
      color: true,
      description: true,
      _count: { select: { articles: true } },
    },
  });
}

export type KbTreeNode = {
  id: string;
  title: string;
  icon: string | null;
  parentId: string | null;
  order: number;
  status: 'DRAFT' | 'PUBLISHED';
};

/** Flat list of a space's articles (id/title/parent/order) for the tree. */
export async function getSpaceArticles(spaceId: string): Promise<KbTreeNode[]> {
  return prisma.knowledgeArticle.findMany({
    where: { spaceId },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, title: true, icon: true, parentId: true, order: true, status: true },
  });
}

/** One space with description/colour + article count, for the space page. */
export async function getSpace(id: string) {
  return prisma.knowledgeSpace.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      icon: true,
      color: true,
      archivedAt: true,
      _count: { select: { articles: true } },
    },
  });
}

export async function isSpaceFavorite(userId: string, spaceId: string): Promise<boolean> {
  const row = await prisma.knowledgeFavorite.findUnique({
    where: { userId_spaceId: { userId, spaceId } },
    select: { id: true },
  });
  return !!row;
}

export type KbSidebarNode = KbTreeNode & { spaceId: string };

/**
 * Flat list of every non-archived space's articles (with spaceId) — feeds the
 * persistent KB sidebar tree in one query instead of N per-space queries.
 */
export async function getAllArticlesForSidebar(): Promise<KbSidebarNode[]> {
  return prisma.knowledgeArticle.findMany({
    where: { space: { archivedAt: null } },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, title: true, icon: true, parentId: true, order: true, status: true, spaceId: true },
  });
}

/** Ids of the spaces/articles the user has starred — drives the sidebar. */
export async function getFavoriteIds(
  userId: string,
): Promise<{ spaceIds: string[]; articleIds: string[] }> {
  const rows = await prisma.knowledgeFavorite.findMany({
    where: { userId },
    select: { spaceId: true, articleId: true },
  });
  return {
    spaceIds: rows.map((r) => r.spaceId).filter((x): x is string => !!x),
    articleIds: rows.map((r) => r.articleId).filter((x): x is string => !!x),
  };
}

/** Whether the user has starred a specific article (article-page star state). */
export async function isArticleFavorite(userId: string, articleId: string): Promise<boolean> {
  const row = await prisma.knowledgeFavorite.findUnique({
    where: { userId_articleId: { userId, articleId } },
    select: { id: true },
  });
  return !!row;
}

/** Full article for the reading/editing pane. */
export async function getArticle(id: string) {
  return prisma.knowledgeArticle.findUnique({
    where: { id },
    select: {
      id: true,
      spaceId: true,
      title: true,
      content: true,
      icon: true,
      status: true,
      parentId: true,
      updatedAt: true,
      space: { select: { id: true, name: true, icon: true } },
    },
  });
}

/** Breadcrumb chain root→article (the article itself last). Cheap walk up. */
export async function getArticleBreadcrumbs(
  id: string,
): Promise<{ id: string; title: string }[]> {
  const chain: { id: string; title: string }[] = [];
  let cur: string | null = id;
  // Guard against cycles / runaway with a hard cap.
  for (let i = 0; i < 50 && cur; i++) {
    const node: { id: string; title: string; parentId: string | null } | null =
      await prisma.knowledgeArticle.findUnique({
        where: { id: cur },
        select: { id: true, title: true, parentId: true },
      });
    if (!node) break;
    chain.unshift({ id: node.id, title: node.title });
    cur = node.parentId;
  }
  return chain;
}

// ---- Templates ------------------------------------------------------------

/** All templates for the management page: account-wide + every space's. */
export async function listAllTemplates() {
  return prisma.knowledgeTemplate.findMany({
    orderBy: [{ scope: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      name: true,
      description: true,
      icon: true,
      scope: true,
      spaceId: true,
      content: true,
      space: { select: { id: true, name: true, icon: true } },
      updatedAt: true,
    },
  });
}

/** Templates applicable when creating an article in a space: account + that space. */
export async function listTemplatesForSpace(spaceId: string) {
  return prisma.knowledgeTemplate.findMany({
    where: { OR: [{ scope: 'ACCOUNT' }, { scope: 'SPACE', spaceId }] },
    orderBy: [{ scope: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, name: true, description: true, icon: true, scope: true },
  });
}

export async function getTemplate(id: string) {
  return prisma.knowledgeTemplate.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      icon: true,
      scope: true,
      spaceId: true,
      content: true,
    },
  });
}

/** Full-text-ish search across article titles + bodies. */
export async function searchKnowledge(q: string, limit = 20) {
  const term = q.trim();
  if (term.length < 2) return [];
  return prisma.knowledgeArticle.findMany({
    where: {
      // Drafts are hidden from search (TEAMLY behaviour); only published.
      status: 'PUBLISHED',
      OR: [
        { title: { contains: term, mode: 'insensitive' } },
        { content: { contains: term, mode: 'insensitive' } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      title: true,
      icon: true,
      space: { select: { id: true, name: true, icon: true } },
    },
  });
}
