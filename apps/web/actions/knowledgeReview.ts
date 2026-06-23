'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { getSpaceAccessById } from '@/lib/knowledge/access';

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

const deny: ActionResult<never> = { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
const notFound: ActionResult<never> = { ok: false, error: { code: 'NOT_FOUND', message: 'Не найдено' } };

/** Author (with edit rights) submits a DRAFT article for approval by a reviewer. */
export async function requestReviewAction(
  articleId: string,
  reviewerId: string,
): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  const article = await prisma.knowledgeArticle.findUnique({
    where: { id: articleId },
    select: { spaceId: true, status: true },
  });
  if (!article) return notFound;
  const acc = await getSpaceAccessById(me, article.spaceId);
  if (!acc.canEdit) return deny;
  if (article.status === 'PUBLISHED') {
    return { ok: false, error: { code: 'VALIDATION', message: 'Статья уже опубликована' } };
  }
  const reviewer = await prisma.user.findUnique({ where: { id: reviewerId }, select: { id: true } });
  if (!reviewer) return { ok: false, error: { code: 'NOT_FOUND', message: 'Согласующий не найден' } };
  const existing = await prisma.knowledgeArticleReview.findFirst({
    where: { articleId, state: 'PENDING' },
    select: { id: true },
  });
  if (existing) return { ok: false, error: { code: 'VALIDATION', message: 'Уже на согласовании' } };

  // The check above is racy on its own (two concurrent submits both see zero
  // PENDING rows). A partial unique index on (articleId) WHERE state='PENDING'
  // makes the invariant authoritative; map its violation to the same message.
  try {
    const review = await prisma.knowledgeArticleReview.create({
      data: { articleId, requestedById: me.id, reviewerId },
      select: { id: true },
    });
    revalidatePath(`/knowledge/${articleId}`);
    return { ok: true, data: { id: review.id } };
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2002') {
      return { ok: false, error: { code: 'VALIDATION', message: 'Уже на согласовании' } };
    }
    throw e;
  }
}

async function resolvableReview(reviewId: string) {
  return prisma.knowledgeArticleReview.findUnique({
    where: { id: reviewId },
    select: { id: true, articleId: true, reviewerId: true, requestedById: true, state: true, article: { select: { spaceId: true } } },
  });
}

/** The reviewer (or a space manager) approves → article is published. */
export async function approveReviewAction(reviewId: string): Promise<ActionResult> {
  const me = await requireAuth();
  const r = await resolvableReview(reviewId);
  if (!r) return notFound;
  if (r.state !== 'PENDING') return { ok: false, error: { code: 'VALIDATION', message: 'Уже обработано' } };
  const acc = await getSpaceAccessById(me, r.article.spaceId);
  if (r.reviewerId !== me.id && !acc.canManage) return deny;
  await prisma.$transaction([
    prisma.knowledgeArticleReview.update({ where: { id: reviewId }, data: { state: 'APPROVED', resolvedAt: new Date() } }),
    prisma.knowledgeArticle.update({ where: { id: r.articleId }, data: { status: 'PUBLISHED', updatedById: me.id } }),
  ]);
  revalidatePath(`/knowledge/${r.articleId}`);
  revalidatePath('/knowledge');
  return { ok: true };
}

/** The reviewer (or a space manager) rejects with a comment → stays a draft. */
export async function rejectReviewAction(reviewId: string, comment: string): Promise<ActionResult> {
  const me = await requireAuth();
  const r = await resolvableReview(reviewId);
  if (!r) return notFound;
  if (r.state !== 'PENDING') return { ok: false, error: { code: 'VALIDATION', message: 'Уже обработано' } };
  const acc = await getSpaceAccessById(me, r.article.spaceId);
  if (r.reviewerId !== me.id && !acc.canManage) return deny;
  await prisma.knowledgeArticleReview.update({
    where: { id: reviewId },
    data: { state: 'REJECTED', comment: comment.trim().slice(0, 2000) || null, resolvedAt: new Date() },
  });
  revalidatePath(`/knowledge/${r.articleId}`);
  return { ok: true };
}

/** The requester (or a space manager) withdraws a pending request. */
export async function cancelReviewAction(reviewId: string): Promise<ActionResult> {
  const me = await requireAuth();
  const r = await resolvableReview(reviewId);
  if (!r) return notFound;
  if (r.state !== 'PENDING') return { ok: false, error: { code: 'VALIDATION', message: 'Уже обработано' } };
  const acc = await getSpaceAccessById(me, r.article.spaceId);
  if (r.requestedById !== me.id && !acc.canManage) return deny;
  await prisma.knowledgeArticleReview.delete({ where: { id: reviewId } });
  revalidatePath(`/knowledge/${r.articleId}`);
  return { ok: true };
}
