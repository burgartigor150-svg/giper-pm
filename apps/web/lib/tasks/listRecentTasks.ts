import { prisma } from '@giper/db';

export async function listRecentTasksForProject(projectId: string, limit = 5) {
  return prisma.task.findMany({
    where: { projectId },
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
