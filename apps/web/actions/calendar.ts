'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { canEditTaskInternal } from '@/lib/permissions';
import { pushBitrixDeadlineBestEffort } from '@/lib/integrations/bitrix24Outbound';

export type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

/**
 * Move a task's deadline to a different day. Used by the calendar's
 * drag-and-drop affordance. Permission: same gate as inline editing
 * — assignee, creator, project owner/lead, or ADMIN.
 *
 * `newDate` is the date string YYYY-MM-DD picked from the day cell
 * the user dropped onto. We pin the time to the previous deadline's
 * hours/minutes if any (so a 16:00 deadline stays 16:00 on the new
 * day), otherwise default to 18:00 local — close-of-business.
 *
 * For Bitrix-mirrored tasks the outbound push fires best-effort — a
 * Bitrix outage doesn't block the local move.
 */
export async function changeTaskDueDateAction(
  taskId: string,
  newDate: string,
): Promise<ActionResult> {
  const me = await requireAuth();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Bad date' } };
  }
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      dueDate: true,
      creatorId: true,
      assigneeId: true,
      externalSource: true,
      project: {
        select: {
          key: true,
          ownerId: true,
          members: { select: { userId: true, role: true } },
        },
      },
    },
  });
  if (!task) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Не найдено' } };
  }
  if (
    !canEditTaskInternal(
      { id: me.id, role: me.role },
      {
        creatorId: task.creatorId,
        assigneeId: task.assigneeId,
        project: task.project,
      },
    )
  ) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }

  // Preserve hours/minutes of the previous deadline. Default to 18:00.
  const [y, m, d] = newDate.split('-').map(Number);
  const next = new Date(y!, (m! - 1) | 0, d!);
  if (task.dueDate) {
    next.setHours(task.dueDate.getHours(), task.dueDate.getMinutes(), 0, 0);
  } else {
    next.setHours(18, 0, 0, 0);
  }

  await prisma.task.update({
    where: { id: task.id },
    data: { dueDate: next },
  });

  if (task.externalSource === 'bitrix24') {
    await pushBitrixDeadlineBestEffort(task.id);
  }

  revalidatePath('/calendar');
  revalidatePath(`/projects/${task.project.key}/list`);
  return { ok: true };
}
