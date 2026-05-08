import { prisma } from '@giper/db';
import type { SessionUser } from '../permissions';

/**
 * Translate a (viewer, filter) pair into Prisma WHERE fragments. Server-side
 * enforcement: users can only pull data from projects they participate
 * in, and only for themselves — even crafting a URL doesn't bypass it.
 *
 * Visibility is per-stake for everyone (incl. ADMIN/PM): owner, member,
 * or any task ownership.
 */
export type ScopedQuery = {
  /** Effective userId filter — always set to the viewer for now. */
  userId: string | null;
  /** Effective projectId filter, or null = all visible projects. */
  projectId: string | null;
  /** Project IDs the viewer is allowed to see (used as outer guard). */
  visibleProjectIds: string[];
  /** Set of user IDs whose data the viewer is allowed to see. */
  visibleUserIds: Set<string> | null;
};

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

  // Reports show the viewer's own data only — no cross-user lookup.
  return {
    userId: viewer.id,
    projectId,
    visibleProjectIds,
    visibleUserIds: new Set([viewer.id]),
  };
}
