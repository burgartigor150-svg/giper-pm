import { prisma } from '@giper/db';

export type KbReview = {
  id: string;
  state: 'PENDING' | 'APPROVED' | 'REJECTED';
  comment: string | null;
  requestedById: string;
  reviewerId: string;
  reviewerName: string | null;
  requesterName: string | null;
  createdAt: string;
};

/** The most recent review for an article (drives the approval panel). */
export async function getLatestReview(articleId: string): Promise<KbReview | null> {
  const r = await prisma.knowledgeArticleReview.findFirst({
    where: { articleId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      state: true,
      comment: true,
      requestedById: true,
      reviewerId: true,
      createdAt: true,
    },
  });
  if (!r) return null;
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set([r.requestedById, r.reviewerId])] } },
    select: { id: true, name: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  return {
    id: r.id,
    state: r.state as KbReview['state'],
    comment: r.comment,
    requestedById: r.requestedById,
    reviewerId: r.reviewerId,
    reviewerName: nameById.get(r.reviewerId) ?? null,
    requesterName: nameById.get(r.requestedById) ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}
