import type { UserRole } from '@giper/db';
import type { CapabilityKey } from './catalog';

/**
 * Floor clamp applied to a custom role's explicit capability set before it
 * takes effect. It can only ever REMOVE capabilities — never add — so it can
 * never be a source of escalation.
 *
 * Design stance: an admin's EXPLICIT capability choices are honored regardless
 * of the base-role template (the base is only a prefill convenience). What an
 * admin cannot do via any role is widen the truly immovable floors:
 *  - the HARD QUERY GATES (listProjectsForUser per-stake OR, the CRM owner
 *    clamp, canViewProject/canViewTask per-stake) — these have NO catalog
 *    capability at all, so they are structurally ungrantable; nothing to clamp.
 *  - crm.scope.all (see EVERY rep's CRM, org-wide): only legitimate from an
 *    ADMIN/PM template. From any lower base it downgrades to crm.scope.own,
 *    keeping the owner clamp (where:{ownerId}) ON. The two scopes are mutually
 *    exclusive. This is the one capability the clamp narrows, because it grants
 *    cross-owner DATA visibility rather than a section/action toggle.
 *
 * (Earlier the clamp blanket-stripped every cap from a VIEWER-based role. That
 * defeated legitimate patterns like "Auditor = read-only + reports", so it was
 * removed: a VIEWER baseline still grants nothing on its own, but an explicit
 * VIEWER-templated custom role now honors its checked org capabilities.)
 */
export function clampToFloors(
  caps: ReadonlySet<CapabilityKey>,
  baseRole: UserRole,
): Set<CapabilityKey> {
  const out = new Set(caps);

  // Org-wide CRM is grantable only from an ADMIN/PM template; otherwise downgrade
  // to own-scope so the owner clamp stays on (no cross-owner data leak).
  if (out.has('crm.scope.all') && baseRole !== 'ADMIN' && baseRole !== 'PM') {
    out.delete('crm.scope.all');
    out.add('crm.scope.own');
  }
  // Mutually exclusive — 'all' wins if both somehow present.
  if (out.has('crm.scope.all')) out.delete('crm.scope.own');

  return out;
}
