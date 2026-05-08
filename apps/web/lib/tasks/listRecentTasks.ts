import { prisma } from '@giper/db';

/**
 * Recent tasks block on the project overview page. Filtered by per-stake
 * visibility — a viewer who isn't on any of the project's tasks should
 * see an empty list, not the whole feed.
 */
export async function listRecentTasksForProject(
  projectId: string,
  userId: string,
  limit = 5,
) {
  return prisma.task.findMany({
    where: {
      projectId,
      OR: [
        { creatorId: userId },
        { assigneeId: userId },
        { reviewerId: userId },
        { assignments: { some: { userId } } },
        { watchers: { some: { userId } } },
      ],
    },
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
