import { prisma } from '@giper/db';
import { DomainError } from '../errors';
import { canDeleteTask, type SessionUser } from '../permissions';
import { auditTask } from '../audit';

export async function deleteTask(taskId: string, user: SessionUser) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      number: true,
      creatorId: true,
      assigneeId: true,
      project: {
        select: {
          ownerId: true,
          members: { select: { userId: true, role: true } },
          key: true,
        },
      },
      _count: { select: { subtasks: true } },
    },
  });
  if (!task) throw new DomainError('NOT_FOUND', 404);
  if (!canDeleteTask(user, task)) throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);

  if (task._count.subtasks > 0) {
    throw new DomainError('VALIDATION', 400, 'Сначала удалите подзадачи');
  }

  // Audit BEFORE delete (task row will be gone afterwards).
  await auditTask({
    action: 'task.delete',
    taskId: task.id,
    before: {
      number: task.number,
      title: task.title,
      projectKey: task.project.key,
    },
    userId: user.id,
  });

  // TimeEntry has onDelete: SetNull, so historical time logs survive with taskId=null.
  // Comment, TaskStatusChange, Attachment have onDelete: Cascade — gone with the task.
  await prisma.task.delete({ where: { id: taskId } });
}
