import { prisma, type Prisma } from '@giper/db';
import { TASKS_PAGE_SIZE, type TaskListFilter } from '@giper/shared';
import { DomainError } from '../errors';
import { canViewProject, type SessionUser } from '../permissions';

export async function listTasksForProject(
  projectKey: string,
  filter: TaskListFilter,
  user: SessionUser,
) {
  const project = await prisma.project.findUnique({
    where: { key: projectKey },
    select: {
      id: true,
      ownerId: true,
      members: { select: { userId: true, role: true } },
    },
  });
  if (!project) throw new DomainError('NOT_FOUND', 404);
  if (!canViewProject(user, project)) throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);

  const where: Prisma.TaskWhereInput = { projectId: project.id };
  if (filter.status) where.status = filter.status;
  if (filter.priority) where.priority = filter.priority;
  if (filter.assigneeId) where.assigneeId = filter.assigneeId;
  if (filter.q) {
    where.OR = [
      { title: { contains: filter.q, mode: 'insensitive' } },
      { description: { contains: filter.q, mode: 'insensitive' } },
    ];
  }

  const orderBy: Prisma.TaskOrderByWithRelationInput =
    filter.sort === 'assignee'
      ? { assignee: { name: filter.dir } }
      : { [filter.sort]: filter.dir };

  const skip = (filter.page - 1) * TASKS_PAGE_SIZE;

  const [items, total] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy,
      skip,
      take: TASKS_PAGE_SIZE,
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        priority: true,
        type: true,
        estimateHours: true,
        dueDate: true,
        tags: true,
        updatedAt: true,
        assignee: { select: { id: true, name: true, image: true } },
      },
    }),
    prisma.task.count({ where }),
  ]);

  return {
    items,
    total,
    page: filter.page,
    pageSize: TASKS_PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / TASKS_PAGE_SIZE)),
  };
}

export type TaskListResult = Awaited<ReturnType<typeof listTasksForProject>>;
export type TaskListItem = TaskListResult['items'][number];
