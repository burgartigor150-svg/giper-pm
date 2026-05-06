import { prisma } from '@giper/db';
import { DomainError } from '../errors';
import type { SessionUser } from '../permissions';

/** Admin-only soft-delete / re-activate. */
export async function setUserActive(
  userId: string,
  isActive: boolean,
  actor: SessionUser,
) {
  if (actor.role !== 'ADMIN') {
    throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);
  }
  if (userId === actor.id && !isActive) {
    throw new DomainError('VALIDATION', 400, 'Нельзя деактивировать самого себя');
  }
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isActive: true },
  });
  if (!target) throw new DomainError('NOT_FOUND', 404);

  if (!isActive && target.role === 'ADMIN') {
    const otherAdminCount = await prisma.user.count({
      where: { role: 'ADMIN', isActive: true, id: { not: userId } },
    });
    if (otherAdminCount === 0) {
      throw new DomainError('VALIDATION', 400, 'Нельзя деактивировать единственного администратора');
    }
  }

  return prisma.user.update({
    where: { id: userId },
    data: {
      isActive,
      deletedAt: isActive ? null : new Date(),
    },
    select: { id: true, isActive: true },
  });
}
