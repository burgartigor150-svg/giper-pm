import { prisma } from '@giper/db';
import type { AddMemberInput } from '@giper/shared';
import { DomainError } from '../errors';
import { isUniqueConstraintError } from '../prisma-errors';
import { canEditProject, type SessionUser } from '../permissions';
// Member/role management is META — authorize on ORG caps (owner / LEAD / org
// project.edit) ONLY, never a per-project capability. Otherwise a member granted
// a PROJECT role with project.edit could self-promote to LEAD via
// updateProjectMemberRole and persist past revocation. So getEffectiveCaps, NOT
// getEffectiveCapsForProject, here.
import { getEffectiveCaps } from '../capabilities';

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
  if (!canEditProject(user, project, await getEffectiveCaps(user))) {
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
  if (!canEditProject(user, project, await getEffectiveCaps(user))) {
    throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);
  }
  if (project.ownerId === userIdToRemove) {
    throw new DomainError('VALIDATION', 400, 'Нельзя удалить владельца проекта');
  }
  return prisma.projectMember.deleteMany({
    where: { projectId, userId: userIdToRemove },
  });
}

export async function updateProjectMemberRole(
  projectId: string,
  userIdToUpdate: string,
  role: 'LEAD' | 'CONTRIBUTOR' | 'REVIEWER' | 'OBSERVER',
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
  if (!canEditProject(user, project, await getEffectiveCaps(user))) {
    throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);
  }
  const res = await prisma.projectMember.updateMany({
    where: { projectId, userId: userIdToUpdate },
    data: { role },
  });
  if (res.count === 0) {
    throw new DomainError('NOT_FOUND', 404, 'Участник не найден');
  }
  return res;
}
