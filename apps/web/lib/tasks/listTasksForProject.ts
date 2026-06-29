import { prisma, type Prisma } from '@giper/db';
import { TASKS_PAGE_SIZE, type TaskListFilter } from '@giper/shared';
import { DomainError } from '../errors';
import { canViewProject, canViewAllProjectTasks, type SessionUser } from '../permissions';
import { buildTaskFilterClauses } from './buildTaskFilterClauses';

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
      externalSource: true,
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
        { testerId: user.id },
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

  // Per-stake for regular members. Leadership (ADMIN / project owner / project
  // LEAD) sees every task in the project — the full mirror of the Bitrix
  // workgroup — so their clause is empty (match-all) and only the narrowing
  // AND-filters above apply.
  const visibilityClause: Prisma.TaskWhereInput = canViewAllProjectTasks(user, project)
    ? {}
    : {
        OR: [
          { creatorId: user.id },
          { assigneeId: user.id },
          { reviewerId: user.id },
          { testerId: user.id },
          { assignments: { some: { userId: user.id } } },
          { watchers: { some: { userId: user.id } } },
        ],
      };

  const where: Prisma.TaskWhereInput = { projectId: project.id };
  // The list shows and filters the INTERNAL (team-board) status track — the
  // same one the board uses — so it reflects the status the team actually set
  // (the Bitrix-mirror `status` is a read-only upstream field shown only on the
  // task card). Keeping the two views in lockstep avoids "card says Готово but
  // the list says К работе".
  if (filter.status) where.internalStatus = filter.status;
  if (filter.priority) where.priority = filter.priority;
  if (filter.assigneeId) where.assigneeId = filter.assigneeId;
  // q / tags / type / dueWithin / reviewer come from the shared builder as
  // pure NARROWING AND-clauses — the per-stake visibilityClause below is
  // appended to the same array and is never reassigned/clobbered. Overdue
  // guard reads internalStatus, matching the displayed track.
  const andClauses = buildTaskFilterClauses(
    {
      q: filter.q,
      tagIds: filter.tagIds,
      type: filter.type,
      dueWithin: filter.dueWithin,
      reviewerMe: filter.reviewer === 'me',
      testerMe: filter.tester === 'me',
      versionId: filter.versionId,
      componentId: filter.componentId,
    },
    { userId: user.id, statusField: 'internalStatus' },
  );
  andClauses.push(visibilityClause);
  where.AND = andClauses;

  const orderBy: Prisma.TaskOrderByWithRelationInput =
    filter.sort === 'assignee'
      ? { assignee: { name: filter.dir } }
      : filter.sort === 'status'
        ? { internalStatus: filter.dir }
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
        internalStatus: true,
        priority: true,
        type: true,
        estimateHours: true,
        dueDate: true,
        tags: true,
        updatedAt: true,
        parentId: true,
        sprintId: true,
        _count: { select: { subtasks: true } },
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
