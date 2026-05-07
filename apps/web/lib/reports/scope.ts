import { prisma } from '@giper/db';
import type { SessionUser } from '../permissions';

/**
 * Translate a (viewer, filter) pair into Prisma WHERE fragments. Server-side
 * enforcement: regular users cannot pull other people's time data even by
 * crafting a URL — we silently coerce userId back to themselves.
 *
 * Project scoping: ADMIN/PM see everything; everyone else sees only
 * projects they own or are a member of. The frontend filter dropdown
 * sends `projectKey`; we resolve to projectId once and reuse it for
 * every section's query.
 */
export type ScopedQuery = {
  /** Effective userId filter, or null = all visible users. */
  userId: string | null;
  /** Effective projectId filter, or null = all visible projects. */
  projectId: string | null;
  /** Project IDs the viewer is allowed to see (used as outer guard). */
  visibleProjectIds: string[];
  /** Set of user IDs whose data the viewer is allowed to see. */
  visibleUserIds: Set<string> | null; // null = no restriction (ADMIN/PM)
};

export async function resolveScope(
  viewer: SessionUser,
  filter: { projectKey?: string; userId?: string },
): Promise<ScopedQuery> {
  const isPrivileged = viewer.role === 'ADMIN' || viewer.role === 'PM';

  // Project visibility.
  const projects = await prisma.project.findMany({
    where: isPrivileged
      ? {}
      : {
          OR: [
            { ownerId: viewer.id },
            { members: { some: { userId: viewer.id } } },
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

  // User visibility. Privileged users can see anyone; everyone else only
  // sees themselves regardless of what was requested.
  let userId: string | null;
  let visibleUserIds: Set<string> | null;
  if (isPrivileged) {
    userId = filter.userId || null;
    visibleUserIds = null;
  } else {
    userId = viewer.id;
    visibleUserIds = new Set([viewer.id]);
  }

  return { userId, projectId, visibleProjectIds, visibleUserIds };
}
