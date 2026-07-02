import { prisma, type Prisma } from '@giper/db';
import type { ProjectStatusInput } from '@giper/shared';
import type { SessionUser } from '../permissions';
import { getEffectiveCaps } from '../capabilities';

export type ListFilter = {
  /**
   * Visibility scope:
   *
   *   'mine' (default for everyone) — projects the caller has a real
   *     stake in: they own it, are an explicit project member, or have
   *     a task stake (creator / assignee / reviewer / co-assignee /
   *     watcher). Strict — applied to ADMIN/PM too. Projects where the
   *     user has no involvement (e.g. a Bitrix workgroup they were
   *     synced into but hold no task) are hidden.
   *
   *   'all' (ADMIN/PM only) — the entire org. Used by the project
   *     directory / admin tooling, NOT the default list view.
   *     Anyone else asking for 'all' silently falls back to 'mine'.
   */
  scope?: 'mine' | 'all';
  /** Filter by exact status. If omitted, archived are excluded. */
  status?: ProjectStatusInput;
  /** Include archived in result (default false). */
  includeArchived?: boolean;
};

export async function listProjectsForUser(user: SessionUser, filter: ListFilter = {}) {
  const where: Prisma.ProjectWhereInput = {};
  // Org-wide browse is gated by the project.viewAll capability (baseline:
  // ADMIN/PM → identical to before for unassigned users). Resolved here so EVERY
  // caller — pages, actions, and the public REST route — honors it in lockstep.
  // Only flips the `wantAll` opt-in; the per-stake `where.OR` below is untouched,
  // so no capability can ever widen the strict visibility floor.
  const caps = await getEffectiveCaps(user);
  const wantAll = filter.scope === 'all' && caps.has('project.viewAll');

  if (wantAll) {
    // No visibility filter — admin/PM browsing the whole org.
  } else {
    // Visibility = owner OR native member OR Bitrix workgroup member OR task
    // stake. A user sees a project where they have a real stake:
    //
    //   • owner            — they created/own it (never lose a fresh project)
    //   • member           — explicitly added (ProjectMember), NATIVE projects
    //                         only (mirror projects auto-add the workgroup OWNER
    //                         as LEAD, which is not an "I work here" signal).
    //   • Bitrix member     — synced ProjectBitrixMember for a mirror workgroup.
    //                         REINSTATED (was dropped in #88 to declutter): the
    //                         org's projects are almost all Bitrix mirrors, and
    //                         without this the 77 MEMBER employees who hold no
    //                         task in a workgroup can't even reach it to create
    //                         a task or log time. Their real workgroup membership
    //                         is the intended access signal (median 3 projects/
    //                         user, so no meaningful flood).
    //   • task stake        — creator/assignee/reviewer/co-assignee/watcher
    //
    // Strict for everyone, including ADMIN/PM — no role bypass. Org-wide browse
    // is the explicit `scope='all'` opt-in above.
    where.OR = [
      { ownerId: user.id },
      { externalSource: null, members: { some: { userId: user.id } } },
      { bitrixMembers: { some: { userId: user.id } } },
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
      // Space grouping. SELECT only — the `where` (per-stake visibility) is
      // untouched, so grouping by space can never widen what a user sees.
      spaceId: true,
      space: { select: { id: true, name: true, order: true } },
    },
  });
}

export type ProjectListItem = Awaited<ReturnType<typeof listProjectsForUser>>[number];
