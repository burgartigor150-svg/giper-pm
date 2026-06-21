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
    // Visibility = owner OR explicit project member OR task stake.
    //
    // We DELIBERATELY do NOT show a project just because the user is a
    // synced Bitrix workgroup member (ProjectBitrixMember). Bitrix
    // workgroups can be large and a member often holds no task there —
    // surfacing every such project buried the ones that actually matter.
    // A user sees a project only where they have a real stake:
    //
    //   • owner            — they created/own it (never lose a fresh project)
    //   • member           — explicitly added (ProjectMember; manual projects)
    //   • task stake        — creator/assignee/reviewer/co-assignee/watcher
    //                         on any task in the project
    //
    // Strict for everyone, including ADMIN/PM — no role bypass.
    // Admin-grade access (audit log, settings) is gated separately, and
    // org-wide browse is the explicit `scope='all'` opt-in above.
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
