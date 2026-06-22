'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { canEditTaskInternal } from '@/lib/permissions';
import { isUniqueConstraintError } from '@/lib/prisma-errors';
import { parseFigmaUrl } from '@/lib/figma/parseFigmaUrl';

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

const TASK_PERM_SELECT = {
  externalSource: true,
  creatorId: true,
  assigneeId: true,
  project: { select: { ownerId: true, members: { select: { userId: true, role: true } } } },
} as const;

/**
 * Link a Figma design to a task by pasting its share URL. The link renders as a
 * live embed on the task card. Gated by canEditTaskInternal (works on Bitrix
 * mirrors too — it's an internal annotation, not an upstream write).
 */
export async function attachFigmaDesignAction(
  taskId: string,
  projectKey: string,
  taskNumber: number,
  url: string,
): Promise<ActionResult> {
  const me = await requireAuth();
  const parsed = parseFigmaUrl(url);
  if (!parsed) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Это не похоже на ссылку Figma' } };
  }
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: TASK_PERM_SELECT });
  if (!task) return { ok: false, error: { code: 'NOT_FOUND', message: 'Задача не найдена' } };
  if (!canEditTaskInternal(me, { creatorId: task.creatorId, assigneeId: task.assigneeId, externalSource: task.externalSource, project: task.project })) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }
  try {
    await prisma.taskDesign.create({
      data: {
        taskId,
        url: url.trim(),
        fileKey: parsed.fileKey,
        nodeId: parsed.nodeId,
        title: parsed.title,
        addedById: me.id,
      },
    });
  } catch (e) {
    if (isUniqueConstraintError(e)) {
      return { ok: false, error: { code: 'CONFLICT', message: 'Этот макет уже привязан' } };
    }
    throw e;
  }
  revalidatePath(`/projects/${projectKey}/tasks/${taskNumber}`);
  return { ok: true };
}

/** Unlink a Figma design from its task. Same gate as attach. */
export async function removeFigmaDesignAction(
  designId: string,
  projectKey: string,
  taskNumber: number,
): Promise<ActionResult> {
  const me = await requireAuth();
  const design = await prisma.taskDesign.findUnique({
    where: { id: designId },
    select: { task: { select: TASK_PERM_SELECT } },
  });
  if (!design) return { ok: false, error: { code: 'NOT_FOUND', message: 'Макет не найден' } };
  const t = design.task;
  if (!canEditTaskInternal(me, { creatorId: t.creatorId, assigneeId: t.assigneeId, externalSource: t.externalSource, project: t.project })) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }
  await prisma.taskDesign.delete({ where: { id: designId } });
  revalidatePath(`/projects/${projectKey}/tasks/${taskNumber}`);
  return { ok: true };
}
