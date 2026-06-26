import { prisma } from '@giper/db';
import { DomainError } from '../errors';
import { canEditTaskInternal, type SessionUser } from '../permissions';
import { getEffectiveCapsForProject } from '../capabilities';

/**
 * Bulk-path sprint mutation. Mirrors {@link assignTaskToSprintAction}
 * (actions/sprints.ts) but THROWS DomainError instead of returning an
 * ActionResult, so the bulk loop can treat per-item rejections uniformly.
 *
 * Put a task into a sprint (or clear it back to the backlog with
 * sprintId=null). Local-only field, gated by canEditTaskInternal (works on
 * Bitrix-mirror tasks). The sprint MUST belong to the task's project — a
 * crafted cross-project sprintId is rejected.
 */
export async function setTaskSprint(
  taskId: string,
  sprintId: string | null,
  user: SessionUser,
): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      projectId: true,
      creatorId: true,
      assigneeId: true,
      project: { select: { ownerId: true, members: { select: { userId: true, role: true } } } },
    },
  });
  if (!task) throw new DomainError('NOT_FOUND', 404);
  const caps = await getEffectiveCapsForProject(user, task.projectId);
  if (!canEditTaskInternal(user, task, caps)) {
    throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);
  }
  if (sprintId) {
    const sprint = await prisma.sprint.findUnique({
      where: { id: sprintId },
      select: { projectId: true },
    });
    if (!sprint || sprint.projectId !== task.projectId) {
      throw new DomainError('VALIDATION', 400, 'Спринт не из этого проекта');
    }
  }
  await prisma.task.update({ where: { id: taskId }, data: { sprintId } });
}
