import { prisma } from '@giper/db';
import type { UpdateUserInput } from '@giper/shared';
import { DomainError } from '../errors';
import type { SessionUser } from '../permissions';

/** Admin-only: change name/role/timezone for any user. */
export async function updateUser(
  userId: string,
  input: UpdateUserInput,
  actor: SessionUser,
) {
  if (actor.role !== 'ADMIN') {
    throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);
  }
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });
  if (!target) throw new DomainError('NOT_FOUND', 404);

  // Prevent admin from demoting themselves while they're the only ADMIN.
  if (target.id === actor.id && input.role && input.role !== 'ADMIN') {
    const otherAdminCount = await prisma.user.count({
      where: { role: 'ADMIN', isActive: true, id: { not: actor.id } },
    });
    if (otherAdminCount === 0) {
      throw new DomainError('VALIDATION', 400, 'Нельзя понизить единственного администратора');
    }
  }

  return prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
    },
    select: { id: true, email: true, name: true, role: true, timezone: true },
  });
}
