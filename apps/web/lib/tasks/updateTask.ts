import { prisma } from '@giper/db';
import type { UpdateTaskInput } from '@giper/shared';
import { DomainError } from '../errors';
import { canEditTask, type SessionUser } from '../permissions';
import { auditTask } from '../audit';

export async function updateTask(taskId: string, input: UpdateTaskInput, user: SessionUser) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      description: true,
      priority: true,
      type: true,
      estimateHours: true,
      dueDate: true,
      tags: true,
      creatorId: true,
      assigneeId: true,
      project: {
        select: { ownerId: true, members: { select: { userId: true, role: true } } },
      },
    },
  });
  if (!task) throw new DomainError('NOT_FOUND', 404);
  if (!canEditTask(user, task)) throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);

  const before = {
    title: task.title,
    description: task.description,
    priority: task.priority,
    type: task.type,
    estimateHours: task.estimateHours?.toNumber() ?? null,
    dueDate: task.dueDate,
    tags: task.tags,
  };

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.estimateHours !== undefined ? { estimateHours: input.estimateHours } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
    },
    select: {
      id: true,
      title: true,
      description: true,
      priority: true,
      type: true,
      estimateHours: true,
      dueDate: true,
      tags: true,
    },
  });

  const after = {
    title: updated.title,
    description: updated.description,
    priority: updated.priority,
    type: updated.type,
    estimateHours: updated.estimateHours?.toNumber() ?? null,
    dueDate: updated.dueDate,
    tags: updated.tags,
  };

  await auditTask({ action: 'task.update', taskId, before, after, userId: user.id });
  return updated;
}
