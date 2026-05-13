import { prisma } from '@giper/db';
import type { SessionUser } from '../permissions';

/**
 * Translate a (viewer, filter) pair into Prisma WHERE fragments. Server-side
 * enforcement: users can only pull data from projects they participate
 * in, and only for users inside their team scope — even crafting a URL
 * doesn't bypass it.
 *
 * Team scope rule (per product decision):
 *   - PM / ADMIN: own PmTeam members + self.
 *   - Everyone else: just self.
 *
 * Within that scope, `filter.userId` narrows the report to one specific
 * person. If the requested userId is outside the viewer's team scope it
 * is silently ignored (falls back to the full team aggregate).
 */
export type ScopedQuery = {
  /** Effective userId filter — set when one specific user is selected. */
  userId: string | null;
  /** Effective projectId filter, or null = all visible projects. */
  projectId: string | null;
  /** Project IDs the viewer is allowed to see (used as outer guard). */
  visibleProjectIds: string[];
  /** Set of user IDs whose data the viewer is allowed to see. */
  visibleUserIds: Set<string>;
};

/**
 * Users the viewer is allowed to see in reports. Always includes the
 * viewer themselves. For PM/ADMIN it adds the members of teams they own
 * via [[PmTeamMember]] (`pmId = viewer.id`).
 */
export async function getVisibleUserIds(
  viewer: SessionUser,
): Promise<Set<string>> {
  const ids = new Set<string>([viewer.id]);
  if (viewer.role === 'PM' || viewer.role === 'ADMIN') {
    const team = await prisma.pmTeamMember.findMany({
      where: { pmId: viewer.id },
      select: { memberId: true },
    });
    for (const t of team) ids.add(t.memberId);
  }
  return ids;
}

export async function resolveScope(
  viewer: SessionUser,
  filter: { projectKey?: string; userId?: string },
): Promise<ScopedQuery> {
  // Per-stake project visibility — same rule as listProjectsForUser.
  const projects = await prisma.project.findMany({
    where: {
      OR: [
        { ownerId: viewer.id },
        { members: { some: { userId: viewer.id } } },
        {
          tasks: {
            some: {
              OR: [
                { creatorId: viewer.id },
                { assigneeId: viewer.id },
                { reviewerId: viewer.id },
                { assignments: { some: { userId: viewer.id } } },
                { watchers: { some: { userId: viewer.id } } },
              ],
            },
          },
        },
      ],
    },
    select: { id: true, key: true, members: { select: { userId: true } } },
  });
  const visibleProjectIds = projects.map((p) => p.id);
  let projectId: string | null = null;
  if (filter.projectKey) {
    const p = projects.find((pp) => pp.key === filter.projectKey);
    projectId = p?.id ?? null;
  }

  const visibleUserIds = await getVisibleUserIds(viewer);

  // If filter.userId is provided AND inside the visible team, narrow to
  // just that user. Otherwise leave userId=null and aggregate across the
  // whole visible team.
  const requestedUserId =
    filter.userId && visibleUserIds.has(filter.userId)
      ? filter.userId
      : null;

  return {
    userId: requestedUserId,
    projectId,
    visibleProjectIds,
    visibleUserIds,
  };
}
