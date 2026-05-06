import { prisma } from '@giper/db';
import type { UpdateProjectInput } from '@giper/shared';
import { DomainError } from '../errors';
import { canEditProject, type SessionUser } from '../permissions';

export async function updateProject(
  projectId: string,
  input: UpdateProjectInput,
  user: SessionUser,
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      ownerId: true,
      members: { select: { userId: true, role: true } },
    },
  });
  if (!project) throw new DomainError('NOT_FOUND', 404, 'Проект не найден');

  if (!canEditProject(user, project)) {
    throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);
  }

  return prisma.project.update({
    where: { id: projectId },
    data: {
      name: input.name,
      description: input.description,
      client: input.client,
      deadline: input.deadline,
      budgetHours: input.budgetHours ?? null,
      hourlyRate: input.hourlyRate ?? null,
      ...(input.status ? { status: input.status } : {}),
    },
  });
}
