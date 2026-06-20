'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { canEditTaskInternal } from '@/lib/permissions';
import { getEffectiveCaps } from '@/lib/capabilities';
import { deleteObject, putObject } from '@/lib/storage/s3';
import { COVER_PALETTE_SET } from '@/lib/covers/palette';

const MAX_COVER_BYTES = 8 * 1024 * 1024; // 8 MB — covers are display images, not archives.
const COVER_MIME = /^image\//;

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

/** Load a task with the shape canEditTaskInternal needs, plus its current
 *  cover key. Covers are a local-only display field (never synced to Bitrix),
 *  so the internal gate is correct — the strict canEditTask vetoed every
 *  Bitrix-mirror task, leaving the UI's enabled cover controls always failing. */
function loadEditableTask(taskId: string) {
  return prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      creatorId: true,
      assigneeId: true,
      externalSource: true,
      coverImageKey: true,
      project: {
        select: { ownerId: true, members: { select: { userId: true, role: true } } },
      },
    },
  });
}

/**
 * Upload an image and set it as the card's cover. Replaces any existing
 * cover (image or colour); the old S3 object is best-effort deleted.
 */
export async function setCoverImageAction(formData: FormData): Promise<ActionResult> {
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
  if (file.size > MAX_COVER_BYTES) {
    return {
      ok: false,
      error: { code: 'VALIDATION', message: `Лимит ${Math.floor(MAX_COVER_BYTES / 1024 / 1024)} МБ` },
    };
  }
  const mime = file.type || '';
  if (!COVER_MIME.test(mime)) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Обложка должна быть изображением' } };
  }

  const task = await loadEditableTask(taskId);
  if (!task) return { ok: false, error: { code: 'NOT_FOUND', message: 'Задача не найдена' } };
  if (!canEditTaskInternal({ id: me.id, role: me.role }, task, await getEffectiveCaps({ id: me.id, role: me.role }))) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }

  const rand = Math.random().toString(36).slice(2, 10);
  const ext = mime.split('/')[1]?.replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'img';
  const key = `covers/${taskId}/${rand}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await putObject({ key, body: buffer, contentType: mime });

  const oldKey = task.coverImageKey;
  await prisma.task.update({
    where: { id: taskId },
    data: { coverImageKey: key, coverColor: null },
  });
  if (oldKey && oldKey !== key) {
    try {
      await deleteObject(oldKey);
    } catch (e) {
      console.error('cover: old object delete failed', oldKey, e);
    }
  }

  revalidateCover(projectKey, taskNumber);
  return { ok: true };
}

/** Set a solid-colour cover from the preset palette. Clears any image cover. */
export async function setCoverColorAction(
  taskId: string,
  projectKey: string,
  taskNumber: number,
  color: string,
): Promise<ActionResult> {
  const me = await requireAuth();
  if (!COVER_PALETTE_SET.has(color)) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Недопустимый цвет' } };
  }
  const task = await loadEditableTask(taskId);
  if (!task) return { ok: false, error: { code: 'NOT_FOUND', message: 'Задача не найдена' } };
  if (!canEditTaskInternal({ id: me.id, role: me.role }, task, await getEffectiveCaps({ id: me.id, role: me.role }))) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }

  const oldKey = task.coverImageKey;
  await prisma.task.update({
    where: { id: taskId },
    data: { coverColor: color, coverImageKey: null },
  });
  if (oldKey) {
    try {
      await deleteObject(oldKey);
    } catch (e) {
      console.error('cover: old object delete failed', oldKey, e);
    }
  }
  revalidateCover(projectKey, taskNumber);
  return { ok: true };
}

/** Remove the cover entirely (image deleted from S3, both fields nulled). */
export async function clearCoverAction(
  taskId: string,
  projectKey: string,
  taskNumber: number,
): Promise<ActionResult> {
  const me = await requireAuth();
  const task = await loadEditableTask(taskId);
  if (!task) return { ok: false, error: { code: 'NOT_FOUND', message: 'Задача не найдена' } };
  if (!canEditTaskInternal({ id: me.id, role: me.role }, task, await getEffectiveCaps({ id: me.id, role: me.role }))) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }
  const oldKey = task.coverImageKey;
  await prisma.task.update({
    where: { id: taskId },
    data: { coverImageKey: null, coverColor: null },
  });
  if (oldKey) {
    try {
      await deleteObject(oldKey);
    } catch (e) {
      console.error('cover: old object delete failed', oldKey, e);
    }
  }
  revalidateCover(projectKey, taskNumber);
  return { ok: true };
}

function revalidateCover(projectKey: string, taskNumber: number) {
  if (projectKey && taskNumber) {
    revalidatePath(`/projects/${projectKey}/tasks/${taskNumber}`);
    revalidatePath(`/projects/${projectKey}/board`);
  }
}