import { prisma, type Prisma } from '@giper/db';
import type { ProjectStatusInput } from '@giper/shared';
import type { SessionUser } from '../permissions';
import { getEffectiveCaps } from '../capabilities';

export type ListFilter = {
  /**
   * Visibility scope:
   *
   *   'mine' (default for everyone) — projects the caller is on:
   *     Bitrix sonet_group member OR has a task stake (creator /
   *     assignee / reviewer / co-assignee / watcher). Strict —
   *     applied to ADMIN/PM too. Empty workgroups are hidden.
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
    // Visibility = (Bitrix sonet_group member) OR (task stake).
    //
    // Bitrix-mirrored projects carry their membership in
    // ProjectBitrixMember (synced from sonet_group.users.get). The
    // moment Bitrix adds someone to the workgroup, we want them to
    // see the project — even before any task is assigned. That's the
    // "никто не должен видеть проект если не состоит в Битриксе"
    // requirement.
    //
    // Task stake is the second leg: a user creator/assignee/
    // reviewer/co-assignee/watcher on any task in the project also
    // sees it. This covers manually-created (non-Bitrix) projects
    // and edge cases where Bitrix membership sync is lagging behind
    // a task assignment.
    //
    // Strict for everyone, including ADMIN/PM — no role bypass.
    // Admin-grade access (audit log, settings) is gated separately.
    where.OR = [
      // Bitrix-group membership: either directly resolved (userId)
      // or matched against a Bitrix id we already know is theirs.
      { bitrixMembers: { some: { userId: user.id } } },
      // Task stake.
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
