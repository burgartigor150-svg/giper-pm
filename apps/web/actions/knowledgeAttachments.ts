'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { getSpaceAccessById } from '@/lib/knowledge/access';
import { buildKbAttachmentKey, deleteObject, putObject } from '@/lib/storage/s3';

// Cap at 9 MB so a friendly validation fires BEFORE Next's 10 MB Server-Action
// body limit (next.config.mjs) rejects the request with an opaque error.
const MAX_BYTES = 9 * 1024 * 1024;
const ALLOWED_MIME = /^(image|video|audio|application|text)\//;
// Script-executable types are rejected at upload (defense in depth — the
// download route also forces non-safe types to download, never inline).
const DANGEROUS_MIME = /(text\/html|xhtml|\bsvg\b|svg\+xml|javascript|x-msdownload|x-msdos-program)/i;

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

/**
 * Upload one file to a KB article. Bytes go to S3, a KnowledgeAttachment row is
 * created. Multi-file is the client looping this per file (per-file progress).
 * Permission: canEdit on the article's space (same gate as editing the article).
 */
export async function uploadKbAttachmentAction(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  const articleId = String(formData.get('articleId') ?? '');
  const file = formData.get('file');

  if (!articleId || !(file instanceof File)) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Нет файла' } };
  }
  if (file.size === 0) return { ok: false, error: { code: 'VALIDATION', message: 'Пустой файл' } };
  if (file.size > MAX_BYTES) {
    return { ok: false, error: { code: 'VALIDATION', message: `Лимит ${Math.floor(MAX_BYTES / 1024 / 1024)} МБ` } };
  }
  const mime = file.type || 'application/octet-stream';
  if (!ALLOWED_MIME.test(mime) || DANGEROUS_MIME.test(mime)) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Тип файла не разрешён' } };
  }

  const article = await prisma.knowledgeArticle.findUnique({
    where: { id: articleId },
    select: { spaceId: true },
  });
  if (!article) return { ok: false, error: { code: 'NOT_FOUND', message: 'Статья не найдена' } };
  const acc = await getSpaceAccessById(me, article.spaceId);
  if (!acc.canEdit) return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };

  const key = buildKbAttachmentKey(articleId, file.name);
  const buffer = Buffer.from(await file.arrayBuffer());
  await putObject({ key, body: buffer, contentType: mime });

  const created = await prisma.knowledgeAttachment.create({
    data: {
      articleId,
      filename: file.name.slice(0, 200),
      mimeType: mime,
      sizeBytes: file.size,
      storageKey: key,
      uploadedById: me.id,
    },
    select: { id: true },
  });
  revalidatePath(`/knowledge/${articleId}`);
  return { ok: true, data: { id: created.id } };
}

/**
 * Delete a KB attachment (S3 object + row). Permission: a space editor or the
 * uploader. S3 errors don't block the row deletion (orphan object > dangling row).
 */
export async function deleteKbAttachmentAction(attachmentId: string): Promise<ActionResult> {
  const me = await requireAuth();
  const att = await prisma.knowledgeAttachment.findUnique({
    where: { id: attachmentId },
    select: {
      id: true,
      storageKey: true,
      uploadedById: true,
      articleId: true,
      article: { select: { spaceId: true } },
    },
  });
  if (!att) return { ok: false, error: { code: 'NOT_FOUND', message: 'Не найдено' } };
  const acc = await getSpaceAccessById(me, att.article.spaceId);
  if (!acc.canEdit && att.uploadedById !== me.id) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }
  if (att.storageKey) {
    try {
      await deleteObject(att.storageKey);
    } catch (e) {
      console.error('kb s3 delete failed for', att.storageKey, e);
    }
  }
  await prisma.knowledgeAttachment.delete({ where: { id: att.id } });
  revalidatePath(`/knowledge/${att.articleId}`);
  return { ok: true };
}
