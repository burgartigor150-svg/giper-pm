import { prisma, Prisma } from '@giper/db';
import type { CreateProjectInput } from '@giper/shared';
import { DomainError } from '../errors';
import { canCreateProject, type SessionUser } from '../permissions';

export async function createProject(input: CreateProjectInput, user: SessionUser) {
  if (!canCreateProject(user)) {
    throw new DomainError('INSUFFICIENT_PERMISSIONS', 403, 'Only ADMIN/PM can create projects');
  }

  try {
    return await prisma.project.create({
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
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new DomainError('CONFLICT', 409, 'Проект с таким ключом уже существует');
    }
    throw e;
  }
}
