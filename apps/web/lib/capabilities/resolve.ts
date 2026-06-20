import { cache } from 'react';
import { prisma, type UserRole } from '@giper/db';
import type { SessionUser } from '../permissions';
import { BASELINE_CAPS } from './baseline';
import { clampToFloors } from './floors';
import { isCapabilityKey, type CapabilityKey } from './catalog';

/**
 * Effective org capabilities for a request. `has(key)` is the only thing call
 * sites need; `source`/`roleId` are for the admin preview + debugging.
 */
export type EffectiveCaps = {
  has: (k: CapabilityKey) => boolean;
  source: 'baseline' | 'custom';
  roleId?: string;
};

/** A user's active ORG custom-role assignment, or null (→ baseline). */
export type RawAssignment = {
  caps: Set<CapabilityKey>;
  baseRole: UserRole;
  roleId: string;
} | null;

/**
 * Read the user's active ORG custom-role assignment from the DB. Fault-tolerant
 * → null (never elevates on error), mirroring getMyCrmAccess. NEVER reads the
 * JWT, so an admin's revoke takes effect on the user's very next request.
 * Junk/unknown capability strings are dropped (can never grant).
 */
export async function loadCustomCaps(userId: string): Promise<RawAssignment> {
  try {
    const row = await prisma.userCustomRole.findUnique({
      where: { userId },
      select: {
        customRole: {
          select: { id: true, isActive: true, deletedAt: true, scope: true, capabilities: true, baseRole: true },
        },
      },
    });
    const cr = row?.customRole;
    if (!cr || !cr.isActive || cr.deletedAt || cr.scope !== 'ORG') return null;
    const caps = new Set<CapabilityKey>(cr.capabilities.filter(isCapabilityKey));
    return { caps, baseRole: cr.baseRole, roleId: cr.id };
  } catch (e) {
    console.warn('loadCustomCaps: unavailable', e);
    return null; // → baseline, never all-caps
  }
}

/** Request-memoized wrapper: N gated checks in one render/action = 1 query. */
export const getMyCustomCaps = cache(loadCustomCaps);

/**
 * Pure resolver — the heart of the model. REPLACE semantics: when an active
 * assignment exists, its (floor-clamped) explicit set IS the answer (no union),
 * which is what makes RESTRICT expressible. No assignment / DB blip → the
 * UserRole baseline (identical to today).
 */
export function resolveEffectiveCaps(user: SessionUser, raw: RawAssignment): EffectiveCaps {
  if (raw === null) {
    const set = BASELINE_CAPS[user.role];
    return { has: (k) => set.has(k), source: 'baseline' };
  }
  const effective = clampToFloors(raw.caps, raw.baseRole);
  return { has: (k) => effective.has(k), source: 'custom', roleId: raw.roleId };
}

/** Convenience: resolve the current user's effective caps from the DB. */
export async function getEffectiveCaps(user: SessionUser): Promise<EffectiveCaps> {
  return resolveEffectiveCaps(user, await getMyCustomCaps(user.id));
}
