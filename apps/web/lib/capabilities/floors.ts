import type { UserRole } from '@giper/db';
import { CAPABILITY_KEYS, type CapabilityKey } from './catalog';

/**
 * Floor clamp applied to a custom role's explicit capability set before it
 * takes effect. It can only ever REMOVE capabilities — never add — so it can
 * never be a source of escalation.
 *
 * Two rules:
 *  1. VIEWER-templated roles can restrict further but can NEVER escalate past
 *     the VIEWER floor (a VIEWER-based role grants no org capability).
 *  2. crm.scope.all (org-wide CRM) is only legitimate from an ADMIN/PM template;
 *     from any other base it downgrades to crm.scope.own, keeping the owner
 *     clamp (where:{ownerId}) ON. The two scopes are mutually exclusive.
 *
 * The three HARD QUERY GATES (listProjectsForUser per-stake OR, the CRM owner
 * clamp, canViewProject/canViewTask per-stake) are NOT clamped here because no
 * capability is wired to widen them in the first place — there is deliberately
 * no project.viewAny / task.viewAny key.
 */

// Every org capability — a VIEWER-templated role is stripped of all of them.
const ALL_CAPS: readonly CapabilityKey[] = CAPABILITY_KEYS;

export function clampToFloors(
  caps: ReadonlySet<CapabilityKey>,
  baseRole: UserRole,
): Set<CapabilityKey> {
  const out = new Set(caps);

  if (baseRole === 'VIEWER') {
    for (const k of ALL_CAPS) out.delete(k);
    return out; // VIEWER floor: nothing org-level, full stop.
  }

  // Org-wide CRM is grantable only from an ADMIN/PM template; otherwise downgrade.
  if (out.has('crm.scope.all') && baseRole !== 'ADMIN' && baseRole !== 'PM') {
    out.delete('crm.scope.all');
    out.add('crm.scope.own');
  }
  // Mutually exclusive — 'all' wins if both somehow present.
  if (out.has('crm.scope.all')) out.delete('crm.scope.own');

  return out;
}
