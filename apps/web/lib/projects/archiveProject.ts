import { prisma } from '@giper/db';
import { DomainError } from '../errors';
import { canEditProject, type SessionUser } from '../permissions';
import { getEffectiveCapsForProject } from '../capabilities';

export async function archiveProject(projectId: string, user: SessionUser) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      ownerId: true,
      members: { select: { userId: true, role: true } },
    },
  });
  if (!project) throw new DomainError('NOT_FOUND', 404);
  if (!canEditProject(user, project, await getEffectiveCapsForProject(user, projectId))) {
    throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);
  }

  return prisma.project.update({
    where: { id: projectId },
    data: { status: 'ARCHIVED', archivedAt: new Date() },
  });
}
