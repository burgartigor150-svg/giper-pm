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
    select: {
      id: true,
      role: true,
      isActive: true,
      positions: { select: { position: true }, take: 1 },
    },
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

  // Activation gate: require role + at least one position so the welcome
  // notification we send to Bitrix can quote both. Deactivation isn't
  // gated — admins still need to be able to disable a stale account.
  if (isActive && !target.isActive) {
    if (!target.role) {
      throw new DomainError('VALIDATION', 400, 'Перед активацией укажите роль');
    }
    if (target.positions.length === 0) {
      throw new DomainError(
        'VALIDATION',
        400,
        'Перед активацией укажите хотя бы одну должность',
      );
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
