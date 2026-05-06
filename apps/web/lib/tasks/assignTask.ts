import { prisma } from '@giper/db';
import { DomainError } from '../errors';
import { canEditTask, type SessionUser } from '../permissions';
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
  if (!canEditTask(user, task)) throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);

  if (assigneeId) {
    const isMember =
      assigneeId === task.project.ownerId ||
      task.project.members.some((m) => m.userId === assigneeId);
    if (!isMember) {
      throw new DomainError('VALIDATION', 400, 'Нельзя назначить не-участника');
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
