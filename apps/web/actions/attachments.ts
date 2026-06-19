'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { canEditTaskInternal } from '@/lib/permissions';
import { buildAttachmentKey, deleteObject, putObject } from '@/lib/storage/s3';

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB per file — sane default for screenshots / PDFs.
const ALLOWED_MIME = /^(image|video|audio|application|text)\//;

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

/**
 * Receive a single file upload from the browser, push to S3, create the
 * Attachment row. Multi-file is handled by the client looping this for
 * each picked file — keeps the server action simple and enables per-file
 * progress / failure handling.
 *
 * Permission: task editors (canEditTaskInternal — ADMIN / owner / LEAD /
 * creator / assignee), matching the upload UI's render guard. Files
 * visibility follows the task — if you can see the task you can read them.
 */
export async function uploadAttachmentAction(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();

  const taskId = String(formData.get('taskId') ?? '');
  const projectKey = String(formData.get('projectKey') ?? '');
  const taskNumber = Number(formData.get('taskNumber') ?? 0);
  const file = formData.get('file');

  if (!taskId || !(file instanceof File)) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Нет файла' } };
  }
  if (file.size === 0) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Пустой файл' } };
  }
  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      error: { code: 'VALIDATION', message: `Лимит ${Math.floor(MAX_BYTES / 1024 / 1024)} МБ` },
    };
  }
  const mime = file.type || 'application/octet-stream';
  if (!ALLOWED_MIME.test(mime)) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Тип файла не разрешён' } };
  }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      creatorId: true,
      assigneeId: true,
      project: {
        select: { ownerId: true, members: { select: { userId: true, role: true } } },
      },
    },
  });
  if (!task) return { ok: false, error: { code: 'NOT_FOUND', message: 'Задача не найдена' } };
  // Gate on the same permission as the upload UI (canEditTaskInternal:
  // ADMIN / owner / LEAD / creator / assignee). Previously this used the
  // per-stake canViewTask with an incomplete select, so project owners,
  // LEADs and ADMINs who saw the dropzone got "Нет доступа".
  if (!canEditTaskInternal({ id: me.id, role: me.role }, task)) {
    return {
      ok: false,
      error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Нет доступа' },
    };
  }

  const key = buildAttachmentKey(taskId, file.name);
  const buffer = Buffer.from(await file.arrayBuffer());
  await putObject({ key, body: buffer, contentType: mime });

  const created = await prisma.attachment.create({
    data: {
      taskId,
      filename: file.name.slice(0, 200),
      mimeType: mime,
      sizeBytes: file.size,
      storageKey: key,
      uploadedById: me.id,
      // No external linkage — this is a locally-uploaded file.
    },
    select: { id: true },
  });

  if (projectKey && taskNumber) {
    revalidatePath(`/projects/${projectKey}/tasks/${taskNumber}`);
  }
  return { ok: true, data: { id: created.id } };
}

/**
 * Delete a locally-uploaded attachment. Removes both the S3 object and
 * the Attachment row. Mirrored (Bitrix) attachments aren't deletable
 * here — they round-trip via the source-of-truth.
 */
export async function deleteAttachmentAction(
  attachmentId: string,
  projectKey: string,
  taskNumber: number,
): Promise<ActionResult> {
  const me = await requireAuth();
  const att = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    select: {
      id: true,
      storageKey: true,
      externalSource: true,
      uploadedById: true,
      task: {
        select: {
          creatorId: true,
          assigneeId: true,
          project: {
            select: {
              ownerId: true,
              members: { select: { userId: true, role: true } },
            },
          },
        },
      },
    },
  });
  if (!att) return { ok: false, error: { code: 'NOT_FOUND', message: 'Не найдено' } };
  if (att.externalSource) {
    return {
      ok: false,
      error: { code: 'VALIDATION', message: 'Внешние файлы удаляются в источнике' },
    };
  }
  // Internal editors of the task can delete its local attachments — this
  // matches the UI, which shows the trash icon to canEditTaskInternal
  // (ADMIN / creator / assignee / owner / LEAD) plus the uploader. Without
  // creator/assignee here, the assignee saw an enabled trash that errored.
  const canDelete =
    me.role === 'ADMIN' ||
    att.uploadedById === me.id ||
    att.task.creatorId === me.id ||
    att.task.assigneeId === me.id ||
    att.task.project.ownerId === me.id ||
    att.task.project.members.some((m) => m.userId === me.id && m.role === 'LEAD');
  if (!canDelete) {
    return {
      ok: false,
      error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' },
    };
  }
  if (att.storageKey) {
    try {
      await deleteObject(att.storageKey);
    } catch (e) {
      // Don't block the row deletion on a storage error — orphaned S3
      // objects are easier to clean up than dangling DB rows.
      // eslint-disable-next-line no-console
      console.error('s3 delete failed for', att.storageKey, e);
    }
  }
  await prisma.attachment.delete({ where: { id: att.id } });
  revalidatePath(`/projects/${projectKey}/tasks/${taskNumber}`);
  return { ok: true };
}
