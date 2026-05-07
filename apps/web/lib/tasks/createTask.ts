import { prisma } from '@giper/db';
import type { CreateTaskInput } from '@giper/shared';
import { DomainError } from '../errors';
import { isUniqueConstraintError } from '../prisma-errors';
import { canCreateTask, type SessionUser } from '../permissions';
import { auditTask } from '../audit';

/**
 * Creates a task with auto-incremented `number` (per project).
 *
 * Concurrency: two simultaneous creates can both compute the same `number`,
 * the second one fails on the unique (projectId, number) index. We retry up
 * to 10 times with random jitter. For our scale (single-digit users) this is
 * plenty; if write load grows we'll switch to a Project.nextTaskNumber column
 * with `update increment` (atomic).
 */
const MAX_RETRIES = 10;

export async function createTask(input: CreateTaskInput, user: SessionUser) {
  const project = await prisma.project.findUnique({
    where: { key: input.projectKey },
    select: {
      id: true,
      ownerId: true,
      members: { select: { userId: true, role: true } },
    },
  });
  if (!project) throw new DomainError('NOT_FOUND', 404, 'Проект не найден');
  if (!canCreateTask(user, project)) {
    throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);
  }

  // Validate assignee is in the project (or the actor is unassigning).
  if (input.assigneeId) {
    const isMember =
      input.assigneeId === project.ownerId ||
      project.members.some((m) => m.userId === input.assigneeId);
    if (!isMember) {
      throw new DomainError('VALIDATION', 400, 'Нельзя назначить не-участника');
    }
  }

  // Validate the parent task (if any) belongs to the same project.
  // Cross-project parents would break project-scoped queries (kanban,
  // list, status counts) and aren't a real use-case.
  if (input.parentId) {
    const parent = await prisma.task.findUnique({
      where: { id: input.parentId },
      select: { projectId: true },
    });
    if (!parent) {
      throw new DomainError('VALIDATION', 400, 'Родительская задача не найдена');
    }
    if (parent.projectId !== project.id) {
      throw new DomainError(
        'VALIDATION',
        400,
        'Подзадача должна быть в том же проекте, что и родитель',
      );
    }
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const max = await prisma.task.aggregate({
      where: { projectId: project.id },
      _max: { number: true },
    });
    const nextNumber = (max._max.number ?? 0) + 1;

    try {
      const created = await prisma.task.create({
        data: {
          projectId: project.id,
          number: nextNumber,
          title: input.title,
          description: input.description,
          priority: input.priority ?? 'MEDIUM',
          type: input.type ?? 'TASK',
          creatorId: user.id,
          assigneeId: input.assigneeId ?? null,
          estimateHours: input.estimateHours ?? null,
          dueDate: input.dueDate ?? null,
          tags: input.tags ?? [],
          parentId: input.parentId ?? null,
        },
        select: {
          id: true,
          number: true,
          project: { select: { key: true } },
        },
      });

      await auditTask({
        action: 'task.create',
        taskId: created.id,
        after: { number: created.number, title: input.title },
        userId: user.id,
      });

      return created;
    } catch (e) {
      if (isUniqueConstraintError(e)) {
        lastErr = e;
        // Jittered backoff: 0..50ms × attempt, prevents thundering herd of retries.
        await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 50) * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr ?? new DomainError('CONFLICT', 409, 'Не удалось присвоить номер задаче');
}
