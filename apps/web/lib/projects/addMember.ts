import { prisma } from '@giper/db';
import type { AddMemberInput } from '@giper/shared';
import { DomainError } from '../errors';
import { isUniqueConstraintError } from '../prisma-errors';
import { canEditProject, type SessionUser } from '../permissions';

export async function addProjectMember(
  projectId: string,
  input: AddMemberInput,
  user: SessionUser,
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      ownerId: true,
      members: { select: { userId: true, role: true } },
    },
  });
  if (!project) throw new DomainError('NOT_FOUND', 404);
  if (!canEditProject(user, project)) {
    throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);
  }

  // Make sure target user exists and is active
  const target = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, isActive: true },
  });
  if (!target || !target.isActive) {
    throw new DomainError('NOT_FOUND', 404, 'Пользователь не найден');
  }

  try {
    return await prisma.projectMember.create({
      data: {
        projectId,
        userId: input.userId,
        role: input.role,
      },
    });
  } catch (e) {
    if (isUniqueConstraintError(e)) {
      throw new DomainError('CONFLICT', 409, 'Пользователь уже в проекте');
    }
    throw e;
  }
}

export async function removeProjectMember(
  projectId: string,
  userIdToRemove: string,
  user: SessionUser,
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      ownerId: true,
      members: { select: { userId: true, role: true } },
    },
  });
  if (!project) throw new DomainError('NOT_FOUND', 404);
  if (!canEditProject(user, project)) {
    throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);
  }
  if (project.ownerId === userIdToRemove) {
    throw new DomainError('VALIDATION', 400, 'Нельзя удалить владельца проекта');
  }
  return prisma.projectMember.deleteMany({
    where: { projectId, userId: userIdToRemove },
  });
}
