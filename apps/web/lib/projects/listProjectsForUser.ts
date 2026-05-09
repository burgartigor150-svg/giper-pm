import { prisma, type Prisma } from '@giper/db';
import type { ProjectStatusInput } from '@giper/shared';
import type { SessionUser } from '../permissions';

export type ListFilter = {
  /**
   * 'mine' (default) → projects where MY TEAM is doing the work,
   *                    not just any project where I'm a stake-holder
   *                    on a single task. The team gate matches the
   *                    calendar's behaviour: assignee ∈ {me, my
   *                    PmTeamMember rows}.
   * 'all'           → admin/PM only — every visible project.
   */
  scope?: 'mine' | 'all';
  /** Filter by exact status. If omitted, archived are excluded. */
  status?: ProjectStatusInput;
  /** Include archived in result (default false). */
  includeArchived?: boolean;
};

async function resolveTeammateIds(uid: string): Promise<string[]> {
  const [asPm, asMember] = await Promise.all([
    prisma.pmTeamMember.findMany({
      where: { pmId: uid },
      select: { memberId: true },
    }),
    prisma.pmTeamMember.findMany({
      where: { memberId: uid },
      select: { pmId: true },
    }),
  ]);
  const ids = new Set<string>([uid]);
  for (const r of asPm) ids.add(r.memberId);
  for (const r of asMember) ids.add(r.pmId);
  if (asMember.length) {
    const peers = await prisma.pmTeamMember.findMany({
      where: { pmId: { in: asMember.map((r) => r.pmId) } },
      select: { memberId: true },
    });
    for (const r of peers) ids.add(r.memberId);
  }
  return [...ids];
}

export async function listProjectsForUser(user: SessionUser, filter: ListFilter = {}) {
  const where: Prisma.ProjectWhereInput = {};
  const isPrivileged = user.role === 'ADMIN' || user.role === 'PM';
  const wantAll = filter.scope === 'all' && isPrivileged;

  if (wantAll) {
    // No visibility filter — admin/PM browsing the whole org.
  } else {
    const teammateIds = await resolveTeammateIds(user.id);
    // Project must have at least one task whose assignee is on my
    // team. Empty Bitrix-mirrored workgroups (owner=me but no tasks)
    // are intentionally HIDDEN — "если в проекте 0 задач, мне нечего
    // там делать". Owning the project alone isn't enough.
    where.tasks = {
      some: {
        OR: [
          { assigneeId: { in: teammateIds } },
          { assigneeId: null, creatorId: user.id },
        ],
      },
    };
  }

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
