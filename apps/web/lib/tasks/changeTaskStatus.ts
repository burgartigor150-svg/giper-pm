import { prisma, type TaskStatus } from '@giper/db';
import { statusSeedId } from '@giper/shared';
import { DomainError } from '../errors';
import { canEditTask, type SessionUser } from '../permissions';
import { getEffectiveCapsForProject } from '../capabilities';
import { isTransitionAllowed } from '../workflow/isTransitionAllowed';
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
      projectId: true,
      creatorId: true,
      assigneeId: true,
      reviewerId: true,
      externalSource: true,
      project: {
        select: { ownerId: true, members: { select: { userId: true, role: true } } },
      },
    },
  });
  if (!task) throw new DomainError('NOT_FOUND', 404);
  const caps = await getEffectiveCapsForProject(user, task.projectId);
  if (!canEditTask(user, task, caps)) throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);

  if (task.status === newStatus) return task;

  // REVIEW gate: if a reviewer is set on the task, REVIEW → DONE must
  // be performed by either the reviewer themselves or an ADMIN. Other
  // transitions are unaffected. Without a reviewer the task works the
  // old way (anyone with edit can close).
  if (
    task.reviewerId &&
    task.status === 'REVIEW' &&
    newStatus === 'DONE' &&
    user.role !== 'ADMIN' &&
    task.reviewerId !== user.id
  ) {
    throw new DomainError(
      'INSUFFICIENT_PERMISSIONS',
      403,
      'Только назначенный ревьюер может перевести задачу в DONE',
    );
  }

  // Configurable workflow: enforce the project's transition allowlist (inert when
  // the project has no rules). Gates the native board write + bulk + task-detail
  // status moves so the mirror `status` can't advance on a forbidden edge.
  if (!(await isTransitionAllowed(task.projectId, task.status, newStatus))) {
    throw new DomainError(
      'TRANSITION_NOT_ALLOWED',
      409,
      'Переход запрещён правилами рабочего процесса проекта',
    );
  }

  const now = new Date();
  const startedAt =
    newStatus === 'IN_PROGRESS' && !task.startedAt ? now : task.startedAt;
  const completedAt =
    newStatus === 'DONE' ? now : task.status === 'DONE' ? null : task.completedAt;

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.task.update({
      where: { id: taskId },
      // S2 dual-write: stamp the mirror-track Status FK alongside the enum.
      data: { status: newStatus, statusId: statusSeedId(task.projectId, newStatus), startedAt, completedAt },
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
