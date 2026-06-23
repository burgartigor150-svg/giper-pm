import { prisma } from '@giper/db';

export type KbReactionGroup = { emoji: string; count: number; mine: boolean };
export type KbCommentNode = {
  id: string;
  authorId: string;
  authorName: string | null;
  authorImage: string | null;
  body: string;
  createdAt: string;
  parentId: string | null;
  reactions: KbReactionGroup[];
  replies: KbCommentNode[];
};

function groupReactions(
  rows: { emoji: string; userId: string }[],
  meId: string,
): KbReactionGroup[] {
  const map = new Map<string, { count: number; mine: boolean }>();
  for (const r of rows) {
    const g = map.get(r.emoji) ?? { count: 0, mine: false };
    g.count += 1;
    if (r.userId === meId) g.mine = true;
    map.set(r.emoji, g);
  }
  return [...map.entries()].map(([emoji, g]) => ({ emoji, ...g }));
}

/** Article comments as a one-level tree, with author info + grouped reactions. */
export async function getArticleComments(articleId: string, meId: string): Promise<KbCommentNode[]> {
  const comments = await prisma.knowledgeComment.findMany({
    where: { articleId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, authorId: true, body: true, parentId: true, createdAt: true },
  });
  if (comments.length === 0) return [];

  const [authors, reactions] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: [...new Set(comments.map((c) => c.authorId))] } },
      select: { id: true, name: true, image: true },
    }),
    prisma.knowledgeReaction.findMany({
      where: { commentId: { in: comments.map((c) => c.id) } },
      select: { commentId: true, emoji: true, userId: true },
    }),
  ]);
  const byAuthor = new Map(authors.map((a) => [a.id, a]));
  const reactionsByComment = new Map<string, { emoji: string; userId: string }[]>();
  for (const r of reactions) {
    if (!r.commentId) continue;
    const arr = reactionsByComment.get(r.commentId) ?? [];
    arr.push({ emoji: r.emoji, userId: r.userId });
    reactionsByComment.set(r.commentId, arr);
  }

  const nodes = new Map<string, KbCommentNode>();
  for (const c of comments) {
    nodes.set(c.id, {
      id: c.id,
      authorId: c.authorId,
      authorName: byAuthor.get(c.authorId)?.name ?? null,
      authorImage: byAuthor.get(c.authorId)?.image ?? null,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
      parentId: c.parentId,
      reactions: groupReactions(reactionsByComment.get(c.id) ?? [], meId),
      replies: [],
    });
  }
  const roots: KbCommentNode[] = [];
  for (const c of comments) {
    const node = nodes.get(c.id)!;
    const parent = c.parentId ? nodes.get(c.parentId) : null;
    if (parent) parent.replies.push(node);
    else roots.push(node);
  }
  return roots;
}

/** Grouped emoji reactions on the article itself. */
export async function getArticleReactions(articleId: string, meId: string): Promise<KbReactionGroup[]> {
  const rows = await prisma.knowledgeReaction.findMany({
    where: { articleId },
    select: { emoji: true, userId: true },
  });
  return groupReactions(rows, meId);
}
