import { prisma } from '@giper/db';

/**
 * Knowledge Base per-space access control.
 *
 * Model (non-breaking — everything is PUBLIC by default):
 *   • PUBLIC space  → any authenticated user reads; any non-VIEWER edits
 *                     (the original org-wide behaviour, unchanged).
 *   • PRIVATE space → only members (or global ADMIN/PM) read; EDITOR/MANAGER
 *                     members (or global ADMIN/PM) edit.
 *   • Manage (settings, members, visibility, delete) → global ADMIN/PM, or a
 *     member with the MANAGER role.
 */

export type KbSessionUser = { id: string; role: string };
export type KbVisibility = 'PUBLIC' | 'PRIVATE';
export type KbSpaceRole = 'EDITOR' | 'MANAGER';

export const isGlobalKbManager = (role: string) => role === 'ADMIN' || role === 'PM';

export type SpaceAccess = { canView: boolean; canEdit: boolean; canManage: boolean };

export function resolveSpaceAccess(
  user: KbSessionUser,
  space: { visibility: KbVisibility },
  membership: { role: KbSpaceRole } | null,
): SpaceAccess {
  const globalMgr = isGlobalKbManager(user.role);
  const isEditor = membership?.role === 'EDITOR' || membership?.role === 'MANAGER';
  const isMgrMember = membership?.role === 'MANAGER';

  if (space.visibility === 'PRIVATE') {
    return {
      canView: globalMgr || !!membership,
      canEdit: globalMgr || isEditor,
      canManage: globalMgr || isMgrMember,
    };
  }
  // PUBLIC — preserves the original org-wide model.
  return {
    canView: true,
    canEdit: globalMgr || user.role !== 'VIEWER',
    canManage: globalMgr || isMgrMember,
  };
}

/**
 * Prisma where-fragment for KnowledgeSpace rows the user may VIEW. Global
 * managers get `{}` (everything); others get PUBLIC ∪ spaces they're a member of.
 * Spread into a space filter, e.g. `{ archivedAt: null, ...viewableSpaceWhere(u) }`.
 */
export function viewableSpaceWhere(user: KbSessionUser) {
  if (isGlobalKbManager(user.role)) return {};
  return {
    OR: [{ visibility: 'PUBLIC' as const }, { members: { some: { userId: user.id } } }],
  };
}

export async function getMembership(spaceId: string, userId: string) {
  return prisma.knowledgeSpaceMember.findUnique({
    where: { spaceId_userId: { spaceId, userId } },
    select: { role: true },
  });
}

/** Resolve access for one space by id (fetches visibility + membership). */
export async function getSpaceAccessById(
  user: KbSessionUser,
  spaceId: string,
): Promise<SpaceAccess & { exists: boolean }> {
  const space = await prisma.knowledgeSpace.findUnique({
    where: { id: spaceId },
    select: { visibility: true },
  });
  if (!space) return { exists: false, canView: false, canEdit: false, canManage: false };
  const membership = isGlobalKbManager(user.role) ? null : await getMembership(spaceId, user.id);
  return { exists: true, ...resolveSpaceAccess(user, space, membership as { role: KbSpaceRole } | null) };
}
