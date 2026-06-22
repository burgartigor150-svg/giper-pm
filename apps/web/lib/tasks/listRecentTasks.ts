import { prisma, type Prisma } from '@giper/db';
import { canViewAllProjectTasks, type ProjectForPerm, type SessionUser } from '../permissions';

/**
 * Recent tasks block on the project overview page. Per-stake for regular
 * members — a viewer who isn't on any of the project's tasks sees an empty
 * list, not the whole feed. Leadership (ADMIN / owner / LEAD) sees the whole
 * recent feed, in lockstep with the board/list/gantt.
 */
export async function listRecentTasksForProject(
  project: ProjectForPerm & { id: string },
  user: SessionUser,
  limit = 5,
) {
  const where: Prisma.TaskWhereInput = { projectId: project.id };
  if (!canViewAllProjectTasks(user, project)) {
    where.OR = [
      { creatorId: user.id },
      { assigneeId: user.id },
      { reviewerId: user.id },
      { assignments: { some: { userId: user.id } } },
      { watchers: { some: { userId: user.id } } },
    ];
  }
  return prisma.task.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      priority: true,
      assignee: { select: { id: true, name: true, image: true } },
      updatedAt: true,
    },
  });
}
