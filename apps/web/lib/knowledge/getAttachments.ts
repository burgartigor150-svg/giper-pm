import { prisma } from '@giper/db';

export type KbAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedById: string | null;
};

/** Attachments of an article, oldest first (upload order). */
export async function getArticleAttachments(articleId: string): Promise<KbAttachment[]> {
  return prisma.knowledgeAttachment.findMany({
    where: { articleId },
    orderBy: { uploadedAt: 'asc' },
    select: { id: true, filename: true, mimeType: true, sizeBytes: true, uploadedById: true },
  });
}
