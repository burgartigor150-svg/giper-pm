import { prisma, type Prisma } from '@giper/db';
import type { ProjectStatusInput } from '@giper/shared';
import type { SessionUser } from '../permissions';

export type ListFilter = {
  /** "mine" → only projects where user is member or owner. "all" → all visible. */
  scope?: 'mine' | 'all';
  /** Filter by exact status. If omitted, archived are excluded. */
  status?: ProjectStatusInput;
  /** Include archived in result (default false). */
  includeArchived?: boolean;
};

export async function listProjectsForUser(user: SessionUser, filter: ListFilter = {}) {
  const where: Prisma.ProjectWhereInput = {};

  // Visibility: always per-stake. ADMIN/PM no longer get a global
  // bypass — they only see projects they participate in. Cross-org
  // browsing happens elsewhere (settings/audit).
  where.OR = [
    { ownerId: user.id },
    { members: { some: { userId: user.id } } },
    {
      tasks: {
        some: {
          OR: [
            { creatorId: user.id },
            { assigneeId: user.id },
            { reviewerId: user.id },
            { assignments: { some: { userId: user.id } } },
            { watchers: { some: { userId: user.id } } },
          ],
        },
      },
    },
  ];

  // Status filter
  if (filter.status) {
    where.status = filter.status;
  } else if (!filter.includeArchived) {
    where.status = { not: 'ARCHIVED' };
  }

  return prisma.project.findMany({
    where,
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    select: {
      id: true,
      key: true,
      name: true,
      status: true,
      client: true,
      deadline: true,
      ownerId: true,
      owner: { select: { id: true, name: true, email: true, image: true } },
      _count: { select: { members: true, tasks: true } },
      updatedAt: true,
    },
  });
}

export type ProjectListItem = Awaited<ReturnType<typeof listProjectsForUser>>[number];
