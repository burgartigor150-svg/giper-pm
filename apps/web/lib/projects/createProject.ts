import { prisma } from '@giper/db';
import type { CreateProjectInput } from '@giper/shared';
import { DomainError } from '../errors';
import { isUniqueConstraintError } from '../prisma-errors';
import { canCreateProject, type SessionUser } from '../permissions';
import { getEffectiveCaps } from '../capabilities';
import { seedProjectStatuses, materializeProjectColumns } from '../status/backfillStatuses';

export async function createProject(input: CreateProjectInput, user: SessionUser) {
  if (!canCreateProject(user, await getEffectiveCaps(user))) {
    throw new DomainError('INSUFFICIENT_PERMISSIONS', 403, 'Only ADMIN/PM can create projects');
  }

  try {
    // Atomically create the project + seed its dynamic statuses + materialize
    // the default board columns (S2), so tasks created in it can resolve their
    // Status/column FKs from the first write.
    return await prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          key: input.key,
          name: input.name,
          description: input.description,
          client: input.client,
          deadline: input.deadline,
          budgetHours: input.budgetHours ?? null,
          hourlyRate: input.hourlyRate ?? null,
          ownerId: user.id,
          members: {
            create: { userId: user.id, role: 'LEAD' },
          },
        },
      });
      await seedProjectStatuses(tx, project.id);
      await materializeProjectColumns(tx, project.id);
      return project;
    });
  } catch (e) {
    if (isUniqueConstraintError(e)) {
      throw new DomainError('CONFLICT', 409, 'Проект с таким ключом уже существует');
    }
    throw e;
  }
}
