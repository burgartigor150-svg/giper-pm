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
};

/** Flat list of a space's articles (id/title/parent/order) for the tree. */
export async function getSpaceArticles(spaceId: string): Promise<KbTreeNode[]> {
  return prisma.knowledgeArticle.findMany({
    where: { spaceId },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, title: true, icon: true, parentId: true, order: true },
  });
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
    select: { id: true, title: true, icon: true, parentId: true, order: true, spaceId: true },
  });
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

/** Full-text-ish search across article titles + bodies. */
export async function searchKnowledge(q: string, limit = 20) {
  const term = q.trim();
  if (term.length < 2) return [];
  return prisma.knowledgeArticle.findMany({
    where: {
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
