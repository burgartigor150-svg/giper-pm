import { prisma } from '@giper/db';
import { DomainError } from '../errors';
import { canManageAssignments, type SessionUser } from '../permissions';
import { auditTask } from '../audit';

export async function assignTask(
  taskId: string,
  assigneeId: string | null,
  user: SessionUser,
) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      assigneeId: true,
      creatorId: true,
      externalSource: true,
      project: {
        select: {
          ownerId: true,
          members: { select: { userId: true, role: true } },
        },
      },
    },
  });
  if (!task) throw new DomainError('NOT_FOUND', 404);
  // Resource management belongs to PM/lead/owner — regular contributors
  // can edit their own tasks but not reassign work.
  if (!canManageAssignments(user, task.project)) {
    throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);
  }

  if (assigneeId) {
    // Confirm the user actually exists; we no longer require formal
    // project membership because Bitrix-mirror groups have no member
    // rows for our users.
    const exists = await prisma.user.findUnique({
      where: { id: assigneeId },
      select: { id: true },
    });
    if (!exists) {
      throw new DomainError('VALIDATION', 400, 'Пользователь не найден');
    }
  }

  if (task.assigneeId === assigneeId) return task;

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: { assigneeId },
    select: { id: true, assigneeId: true },
  });

  await auditTask({
    action: 'task.assign',
    taskId,
    before: { assigneeId: task.assigneeId },
    after: { assigneeId: updated.assigneeId },
    userId: user.id,
  });

  return updated;
}
