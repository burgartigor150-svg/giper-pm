import { prisma } from '@giper/db';
import { DomainError } from '../errors';
import { canEditTaskInternal, type SessionUser } from '../permissions';
import { getEffectiveCapsForProject } from '../capabilities';

/**
 * Bulk-path tag mutation. Mirrors the gate of {@link assignTagToTaskAction}
 * (actions/tags.ts) but THROWS DomainError instead of returning an
 * ActionResult, so the bulk loop in actions/bulkTasks.ts can treat every
 * per-item rejection uniformly (the same shape changeTaskStatus / assignTask /
 * deleteTask already throw). The single-task action keeps its own copy because
 * it also fans out a notification — bulk deliberately stays silent to avoid
 * mass-notify spam.
 */

async function assertCanEditTags(taskId: string, user: SessionUser) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      projectId: true,
      creatorId: true,
      assigneeId: true,
      project: {
        select: { ownerId: true, members: { select: { userId: true, role: true } } },
      },
    },
  });
  if (!task) throw new DomainError('NOT_FOUND', 404);
  const caps = await getEffectiveCapsForProject(user, task.projectId);
  if (!canEditTaskInternal(user, task, caps)) {
    throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);
  }
  return task;
}

/**
 * Add a project tag to a task (idempotent — re-adding an existing link is a
 * no-op success). The tag MUST belong to the task's project, so a crafted
 * cross-project tagId can never land. Gated by canEditTaskInternal (works on
 * Bitrix-mirror tasks; tags are an internal-only concept).
 */
export async function addTagToTask(
  taskId: string,
  tagId: string,
  user: SessionUser,
): Promise<void> {
  const task = await assertCanEditTags(taskId, user);
  const tag = await prisma.tag.findUnique({
    where: { id: tagId },
    select: { projectId: true },
  });
  if (!tag || tag.projectId !== task.projectId) {
    throw new DomainError('NOT_FOUND', 404, 'Тег не из этого проекта');
  }
  await prisma.taskTag.upsert({
    where: { taskId_tagId: { taskId, tagId } },
    create: { taskId, tagId, assignedById: user.id },
    update: {},
  });
}

/**
 * Remove a project tag from a task (idempotent — removing a tag the task does
 * not have is a no-op success, so a bulk loop never errors on a partial match).
 * Same gate + cross-project guard as {@link addTagToTask}.
 */
export async function removeTagFromTask(
  taskId: string,
  tagId: string,
  user: SessionUser,
): Promise<void> {
  const task = await assertCanEditTags(taskId, user);
  const tag = await prisma.tag.findUnique({
    where: { id: tagId },
    select: { projectId: true },
  });
  if (!tag || tag.projectId !== task.projectId) {
    throw new DomainError('NOT_FOUND', 404, 'Тег не из этого проекта');
  }
  await prisma.taskTag.deleteMany({ where: { taskId, tagId } });
}
