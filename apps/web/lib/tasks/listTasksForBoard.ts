import { prisma, type Prisma } from '@giper/db';
import { DomainError } from '../errors';
import { canViewProject, type SessionUser } from '../permissions';

export type BoardFilter = {
  assigneeId?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  q?: string;
  onlyMine?: boolean;
};

/** All non-CANCELED tasks for the project, no pagination — kanban shows everything. */
export async function listTasksForBoard(
  projectKey: string,
  filter: BoardFilter,
  user: SessionUser,
) {
  const project = await prisma.project.findUnique({
    where: { key: projectKey },
    select: {
      id: true,
      key: true,
      name: true,
      ownerId: true,
      members: {
        select: {
          userId: true,
          role: true,
          user: { select: { id: true, name: true, image: true } },
        },
      },
    },
  });
  if (!project) throw new DomainError('NOT_FOUND', 404);
  if (!canViewProject(user, project)) throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);

  const where: Prisma.TaskWhereInput = {
    projectId: project.id,
    status: { not: 'CANCELED' },
  };

  // onlyMine wins over explicit assigneeId
  if (filter.onlyMine) {
    where.assigneeId = user.id;
  } else if (filter.assigneeId) {
    where.assigneeId = filter.assigneeId;
  }

  if (filter.priority) where.priority = filter.priority;
  if (filter.q) {
    where.OR = [
      { title: { contains: filter.q, mode: 'insensitive' } },
      { description: { contains: filter.q, mode: 'insensitive' } },
    ];
  }

  const tasks = await prisma.task.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      priority: true,
      type: true,
      estimateHours: true,
      tags: true,
      assignee: { select: { id: true, name: true, image: true } },
    },
  });

  return { project, tasks };
}

export type BoardTask = Awaited<ReturnType<typeof listTasksForBoard>>['tasks'][number];
