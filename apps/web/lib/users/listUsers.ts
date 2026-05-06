import { prisma } from '@giper/db';

export async function listUsers(opts: { includeInactive?: boolean } = {}) {
  return prisma.user.findMany({
    where: opts.includeInactive ? {} : { isActive: true },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      image: true,
      isActive: true,
      mustChangePassword: true,
      lastPasswordChangeAt: true,
      createdAt: true,
    },
  });
}

export type UserListItem = Awaited<ReturnType<typeof listUsers>>[number];
