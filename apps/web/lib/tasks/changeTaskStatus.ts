import { prisma, type TaskStatus } from '@giper/db';
import { DomainError } from '../errors';
import { canEditTask, type SessionUser } from '../permissions';
import { auditTask } from '../audit';

/**
 * Change status, write a TaskStatusChange row and update startedAt/completedAt.
 *
 * Lifecycle:
 *  - startedAt is set on first transition into IN_PROGRESS
 *  - completedAt is set on transition into DONE
 *  - moving away from DONE clears completedAt (re-opening)
 */
export async function changeTaskStatus(
  taskId: string,
  newStatus: TaskStatus,
  user: SessionUser,
) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      status: true,
      startedAt: true,
      completedAt: true,
      creatorId: true,
      assigneeId: true,
      project: {
        select: { ownerId: true, members: { select: { userId: true, role: true } } },
      },
    },
  });
  if (!task) throw new DomainError('NOT_FOUND', 404);
  if (!canEditTask(user, task)) throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);

  if (task.status === newStatus) return task;

  const now = new Date();
  const startedAt =
    newStatus === 'IN_PROGRESS' && !task.startedAt ? now : task.startedAt;
  const completedAt =
    newStatus === 'DONE' ? now : task.status === 'DONE' ? null : task.completedAt;

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.task.update({
      where: { id: taskId },
      data: { status: newStatus, startedAt, completedAt },
      select: { id: true, status: true, startedAt: true, completedAt: true },
    });
    await tx.taskStatusChange.create({
      data: {
        taskId,
        fromStatus: task.status,
        toStatus: newStatus,
        changedById: user.id,
      },
    });
    return u;
  });

  await auditTask({
    action: 'task.status_change',
    taskId,
    before: { status: task.status },
    after: { status: newStatus },
    userId: user.id,
  });

  return updated;
}
