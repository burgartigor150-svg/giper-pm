import { prisma } from '@giper/db';
import { DomainError } from '../errors';

export async function getUserById(id: string) {
  const u = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      image: true,
      isActive: true,
      timezone: true,
      mustChangePassword: true,
      lastPasswordChangeAt: true,
      createdAt: true,
      bitrixUserId: true,
      positions: {
        orderBy: [{ primary: 'desc' }, { position: 'asc' }],
        select: { position: true, primary: true },
      },
    },
  });
  if (!u) throw new DomainError('NOT_FOUND', 404, 'Пользователь не найден');
  return u;
}

export type UserDetail = Awaited<ReturnType<typeof getUserById>>;
