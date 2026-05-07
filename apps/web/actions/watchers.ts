'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { canViewTask } from '@/lib/permissions';

/**
 * Toggle the current user's TaskWatcher row for the given task. Returns
 * the resulting state so the button can flip without an extra round trip.
 *
 * Permission: any user who can view the task can watch it. Watchers do
 * NOT confer view permission — they only opt-in to notifications.
 */
export async function toggleWatcherAction(
  taskId: string,
  projectKey: string,
  taskNumber: number,
): Promise<
  | { ok: true; watching: boolean }
  | { ok: false; error: { code: string; message: string } }
> {
  const me = await requireAuth();
  const task = await prisma.task.findUnique({
    where: { id: taskId },
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
  });
  if (!task) return { ok: false, error: { code: 'NOT_FOUND', message: 'Не найдено' } };
  if (!canViewTask({ id: me.id, role: me.role }, task)) {
    return {
      ok: false,
      error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Нет доступа' },
    };
  }

  const existing = await prisma.taskWatcher.findUnique({
    where: { taskId_userId: { taskId, userId: me.id } },
    select: { id: true },
  });
  if (existing) {
    await prisma.taskWatcher.delete({ where: { id: existing.id } });
    revalidatePath(`/projects/${projectKey}/tasks/${taskNumber}`);
    return { ok: true, watching: false };
  }
  await prisma.taskWatcher.create({
    data: { taskId, userId: me.id },
  });
  revalidatePath(`/projects/${projectKey}/tasks/${taskNumber}`);
  return { ok: true, watching: true };
}

