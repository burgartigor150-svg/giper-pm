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
      spaceId: true,
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
      // Current user's Bitrix workgroup membership (visibility/access leg).
      bitrixMembers: { where: { userId: user.id }, select: { userId: true } },
      _count: { select: { tasks: true } },
    },
  });
  if (!project) throw new DomainError('NOT_FOUND', 404, 'Проект не найден');

  // Visibility probe: does the user have a task stake here? Combined with
  // owner / native member / Bitrix workgroup member (selected above) this is
  // the full rule (see canViewProject / listProjectsForUser).
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
  const projectForPerm = {
    ...project,
    hasTaskForCurrentUser: userTaskCount > 0,
  };
  if (!canViewProject(user, projectForPerm)) {
    throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);
  }
  return project;
}

export type ProjectDetail = Awaited<ReturnType<typeof getProject>>;
