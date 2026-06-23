'use server';

import { revalidatePath } from 'next/cache';
import { prisma, Prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { getSpaceAccessById } from '@/lib/knowledge/access';

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

const MAX_BODY = 5000;

function deny(): ActionResult<never> {
  return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
}
function notFound(): ActionResult<never> {
  return { ok: false, error: { code: 'NOT_FOUND', message: 'Не найдено' } };
}

async function spaceIdOfArticle(articleId: string) {
  return prisma.knowledgeArticle.findUnique({ where: { id: articleId }, select: { spaceId: true } });
}
async function commentMeta(commentId: string) {
  const c = await prisma.knowledgeComment.findUnique({
    where: { id: commentId },
    select: { authorId: true, articleId: true, article: { select: { spaceId: true } } },
  });
  return c ? { authorId: c.authorId, articleId: c.articleId, spaceId: c.article.spaceId } : null;
}

// ---- Comments -------------------------------------------------------------

/** Comment on an article. Any user who can VIEW the space may comment. */
export async function addCommentAction(
  articleId: string,
  body: string,
  parentId?: string | null,
): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  const text = body.trim();
  if (!text) return { ok: false, error: { code: 'VALIDATION', message: 'Пустой комментарий' } };
  if (text.length > MAX_BODY) return { ok: false, error: { code: 'VALIDATION', message: 'Слишком длинный комментарий' } };
  const art = await spaceIdOfArticle(articleId);
  if (!art) return notFound();
  const acc = await getSpaceAccessById(me, art.spaceId);
  if (!acc.canView) return deny();
  // A reply must belong to the same article AND be one level deep (replies to a
  // reply are rejected server-side, matching the schema + UI contract).
  if (parentId) {
    const parent = await prisma.knowledgeComment.findUnique({
      where: { id: parentId },
      select: { articleId: true, parentId: true },
    });
    if (!parent || parent.articleId !== articleId || parent.parentId !== null) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Некорректный ответ' } };
    }
  }
  const c = await prisma.knowledgeComment.create({
    data: { articleId, authorId: me.id, body: text, parentId: parentId ?? null },
    select: { id: true },
  });
  revalidatePath(`/knowledge/${articleId}`);
  return { ok: true, data: { id: c.id } };
}

export async function updateCommentAction(commentId: string, body: string): Promise<ActionResult> {
  const me = await requireAuth();
  const text = body.trim();
  if (!text) return { ok: false, error: { code: 'VALIDATION', message: 'Пустой комментарий' } };
  const meta = await commentMeta(commentId);
  if (!meta) return notFound();
  if (meta.authorId !== me.id) return deny(); // only the author edits
  await prisma.knowledgeComment.update({ where: { id: commentId }, data: { body: text.slice(0, MAX_BODY) } });
  revalidatePath(`/knowledge/${meta.articleId}`);
  return { ok: true };
}

export async function deleteCommentAction(commentId: string): Promise<ActionResult> {
  const me = await requireAuth();
  const meta = await commentMeta(commentId);
  if (!meta) return notFound();
  // Author, or a space manager, may delete.
  if (meta.authorId !== me.id) {
    const acc = await getSpaceAccessById(me, meta.spaceId);
    if (!acc.canManage) return deny();
  }
  await prisma.knowledgeComment.delete({ where: { id: commentId } });
  revalidatePath(`/knowledge/${meta.articleId}`);
  return { ok: true };
}

// ---- Reactions (race-safe toggle) -----------------------------------------

async function toggleReaction(
  where: { userId: string; articleId?: string; commentId?: string; emoji: string },
  create: Prisma.KnowledgeReactionCreateInput | Prisma.KnowledgeReactionUncheckedCreateInput,
): Promise<boolean> {
  const removed = await prisma.knowledgeReaction.deleteMany({ where });
  if (removed.count > 0) return false;
  try {
    await prisma.knowledgeReaction.create({ data: create });
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
  }
  return true;
}

export async function toggleArticleReactionAction(
  articleId: string,
  emoji: string,
): Promise<ActionResult<{ reacted: boolean }>> {
  const me = await requireAuth();
  const art = await spaceIdOfArticle(articleId);
  if (!art) return notFound();
  const acc = await getSpaceAccessById(me, art.spaceId);
  if (!acc.canView) return deny();
  const reacted = await toggleReaction(
    { userId: me.id, articleId, emoji },
    { userId: me.id, articleId, emoji },
  );
  revalidatePath(`/knowledge/${articleId}`);
  return { ok: true, data: { reacted } };
}

export async function toggleCommentReactionAction(
  commentId: string,
  emoji: string,
): Promise<ActionResult<{ reacted: boolean }>> {
  const me = await requireAuth();
  const meta = await commentMeta(commentId);
  if (!meta) return notFound();
  const acc = await getSpaceAccessById(me, meta.spaceId);
  if (!acc.canView) return deny();
  const reacted = await toggleReaction(
    { userId: me.id, commentId, emoji },
    { userId: me.id, commentId, emoji },
  );
  revalidatePath(`/knowledge/${meta.articleId}`);
  return { ok: true, data: { reacted } };
}
