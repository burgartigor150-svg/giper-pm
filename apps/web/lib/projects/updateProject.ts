import { prisma } from '@giper/db';
import type { UpdateProjectInput } from '@giper/shared';
import { DomainError } from '../errors';
import { canEditProject, type SessionUser } from '../permissions';
import { getEffectiveCapsForProject } from '../capabilities';

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

  if (!canEditProject(user, project, await getEffectiveCapsForProject(user, projectId))) {
    throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);
  }

  return prisma.project.update({
    where: { id: projectId },
    data: {
      name: input.name,
      description: input.description,
      client: input.client,
      deadline: input.deadline,
      // Only touch budget/rate when the caller actually sent them. The edit
      // form has no inputs for these, so `?? null` previously WIPED any
      // existing values (e.g. set via Bitrix sync) on every save. Prisma
      // skips `undefined`, so this preserves them when absent.
      ...(input.budgetHours !== undefined ? { budgetHours: input.budgetHours } : {}),
      ...(input.hourlyRate !== undefined ? { hourlyRate: input.hourlyRate } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
  });
}
