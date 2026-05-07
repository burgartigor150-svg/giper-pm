import { prisma } from '@giper/db';
import type { UpdateTaskInput } from '@giper/shared';
import { DomainError } from '../errors';
import { canEditTask, canEditTaskInternal, type SessionUser } from '../permissions';
import { auditTask } from '../audit';

/**
 * Per-field permission split: writing the title or description on a
 * Bitrix-mirrored task could overwrite the client-facing wording on
 * the next outbound sync, so those stay behind the strict
 * canEditTask. Everything else (priority, estimate, due, tags, type)
 * is internal-only metadata and uses canEditTaskInternal — meaning
 * Bitrix-mirrored tasks ARE editable in those fields.
 */
const MIRROR_BOUND_FIELDS: (keyof UpdateTaskInput)[] = ['title', 'description'];

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
      externalSource: true,
      project: {
        select: { ownerId: true, members: { select: { userId: true, role: true } } },
      },
    },
  });
  if (!task) throw new DomainError('NOT_FOUND', 404);

  const touchesMirrorBound = MIRROR_BOUND_FIELDS.some(
    (k) => input[k as keyof UpdateTaskInput] !== undefined,
  );
  const allowed = touchesMirrorBound
    ? canEditTask(user, task)
    : canEditTaskInternal(user, task);
  if (!allowed) throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);

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
