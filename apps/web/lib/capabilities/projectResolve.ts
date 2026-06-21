import { cache } from 'react';
import { prisma } from '@giper/db';
import type { SessionUser } from '../permissions';
import { getEffectiveCaps, type EffectiveCaps } from './resolve';
import { isCapabilityKey, PROJECT_CAP_SET, type CapabilityKey } from './catalog';

/**
 * Per-project custom-role capabilities — a PARALLEL, UNION overlay on top of the
 * org-level resolver. NOTE this is deliberately NOT folded into
 * resolveEffectiveCaps (which is the ORG, REPLACE-semantics resolver): a
 * per-project role can only ADD project/task capabilities within one project,
 * never restrict org access and never widen visibility.
 *
 * Fault-tolerant → empty Set (never elevates). Read from the DB per request,
 * NEVER from the JWT. Mirrors the org resolver's isActive/!deletedAt/scope
 * checks, then intersects to PROJECT_CAP_SET so a tampered/legacy row can't
 * smuggle an org-surface key.
 */
export async function loadProjectCaps(userId: string, projectId: string): Promise<Set<CapabilityKey>> {
  try {
    const row = await prisma.projectMemberCustomRole.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { customRole: { select: { isActive: true, deletedAt: true, scope: true, capabilities: true } } },
    });
    const cr = row?.customRole;
    if (!cr || !cr.isActive || cr.deletedAt || cr.scope !== 'PROJECT') return new Set();
    return new Set(cr.capabilities.filter(isCapabilityKey).filter((k) => PROJECT_CAP_SET.has(k)));
  } catch (e) {
    console.warn('loadProjectCaps: unavailable', e);
    return new Set(); // → no project grant, never elevates
  }
}

/** Request-memoized, keyed on (userId, projectId) — N gates for the same
 *  (user, project) in one render = 1 query; different projects stay distinct. */
export const getMyProjectCaps = cache(loadProjectCaps);

/**
 * Effective capabilities for a user WITHIN a project: org ∪ project, returned as
 * the same EffectiveCaps shape so every existing gate helper accepts it with no
 * signature change. The `PROJECT_CAP_SET.has(k) &&` guard means the project leg
 * can only ever answer true for the 7 project keys — for any other key the union
 * degenerates to org.has(k), byte-identical to today. So passing this to a
 * non-project gate (canSeeSettings, listProjectsForUser's project.viewAll, …)
 * collapses to pure org caps — no escalation, no visibility widening.
 */
export async function getEffectiveCapsForProject(user: SessionUser, projectId: string): Promise<EffectiveCaps> {
  if (!projectId) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('getEffectiveCapsForProject: missing projectId — falling back to org caps');
    }
    return getEffectiveCaps(user);
  }
  const [org, proj] = await Promise.all([getEffectiveCaps(user), getMyProjectCaps(user.id, projectId)]);
  return {
    has: (k) => org.has(k) || (PROJECT_CAP_SET.has(k) && proj.has(k)),
    source: org.source,
    roleId: org.roleId,
  };
}
