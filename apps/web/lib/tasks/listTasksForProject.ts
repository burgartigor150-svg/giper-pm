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
  // Implicit-membership for Bitrix-mirror groups: user owns at least
  // one task here. Without this, MEMBER would 403 on the list page
  // even when they do have stake in the project.
  const userTaskCount = await prisma.task.count({
    where: {
      projectId: project.id,
      OR: [
        { creatorId: user.id },
        { assigneeId: user.id },
        { reviewerId: user.id },
        { assignments: { some: { userId: user.id } } },
        { watchers: { some: { userId: user.id } } },
      ],
    },
  });
  if (
    !canViewProject(user, {
      ...project,
      hasTaskForCurrentUser: userTaskCount > 0,
    })
  ) {
    throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);
  }

  // Strictly per-stake — even project owner / LEAD don't get a global
  // bypass within their own project. The reason: in Bitrix mirror
  // groups, an upstream task can land in a project you "lead" without
  // your name actually appearing on it. We want to mirror Bitrix's
  // truth, not paint everything yours.
  const visibilityClause: Prisma.TaskWhereInput = {
    OR: [
      { creatorId: user.id },
      { assigneeId: user.id },
      { reviewerId: user.id },
      { assignments: { some: { userId: user.id } } },
      { watchers: { some: { userId: user.id } } },
    ],
  };

  const where: Prisma.TaskWhereInput = { projectId: project.id };
  const andClauses: Prisma.TaskWhereInput[] = [];
  if (filter.status) where.status = filter.status;
  if (filter.priority) where.priority = filter.priority;
  if (filter.assigneeId) where.assigneeId = filter.assigneeId;
  if (filter.q) {
    andClauses.push({
      OR: [
        { title: { contains: filter.q, mode: 'insensitive' } },
        { description: { contains: filter.q, mode: 'insensitive' } },
      ],
    });
  }
  if (filter.tagIds && filter.tagIds.length > 0) {
    // AND: task must carry every selected tag.
    for (const tagId of filter.tagIds) {
      andClauses.push({ taskTags: { some: { tagId } } });
    }
  }
  if (visibilityClause) andClauses.push(visibilityClause);
  if (andClauses.length > 0) where.AND = andClauses;

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
