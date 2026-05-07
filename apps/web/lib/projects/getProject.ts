import { prisma } from '@giper/db';
import { DomainError } from '../errors';
import { canViewProject, type SessionUser } from '../permissions';

export async function getProject(projectKey: string, user: SessionUser) {
  const project = await prisma.project.findUnique({
    where: { key: projectKey },
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      client: true,
      status: true,
      budgetHours: true,
      hourlyRate: true,
      startDate: true,
      deadline: true,
      ownerId: true,
      owner: { select: { id: true, name: true, email: true, image: true } },
      wipLimits: true,
      externalSource: true,
      externalId: true,
      createdAt: true,
      updatedAt: true,
      archivedAt: true,
      members: {
        orderBy: { addedAt: 'asc' },
        select: {
          id: true,
          role: true,
          addedAt: true,
          userId: true,
          user: { select: { id: true, name: true, email: true, image: true, role: true } },
        },
      },
      _count: { select: { tasks: true } },
    },
  });
  if (!project) throw new DomainError('NOT_FOUND', 404, 'Проект не найден');

  // Implicit-membership probe: a single COUNT to know whether the
  // current user has any task in this project (Bitrix-mirror groups
  // typically have no ProjectMember rows for our users).
  const userTaskCount = await prisma.task.count({
    where: {
      projectId: project.id,
      OR: [
        { creatorId: user.id },
        { assigneeId: user.id },
        { assignments: { some: { userId: user.id } } },
      ],
    },
  });
  const projectForPerm = { ...project, hasTaskForCurrentUser: userTaskCount > 0 };
  if (!canViewProject(user, projectForPerm)) {
    throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);
  }
  return project;
}

export type ProjectDetail = Awaited<ReturnType<typeof getProject>>;
