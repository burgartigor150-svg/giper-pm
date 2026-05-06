'use server';

import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';

export type UserSearchHit = {
  id: string;
  name: string;
  email: string;
  image: string | null;
};

export async function searchUsers(query: string): Promise<UserSearchHit[]> {
  await requireAuth();
  const q = query.trim();
  if (q.length < 2) return [];

  const rows = await prisma.user.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true, email: true, image: true },
    orderBy: { name: 'asc' },
    take: 8,
  });
  return rows;
}
