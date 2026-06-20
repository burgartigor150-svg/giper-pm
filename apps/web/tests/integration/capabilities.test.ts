import { describe, it, expect } from 'vitest';

/**
 * Custom-roles dark core (slice 1). Proves the capability overlay is INERT and
 * the resolver is correct BEFORE anything reads it:
 *  - GOLDEN parity: the helper-backed capability keys (the 9 that map to a pure
 *    exported permission helper) are anchored to RUNTIME truth, non-circular.
 *    The remaining keys map to inline `role===` literals that have no exported
 *    helper to call here — those are pinned by an explicit baseline SNAPSHOT
 *    (EXPECTED_* below), so any future edit to baseline.ts trips a visible test
 *    diff, plus the structural invariants. (Full literal↔cap equivalence is
 *    proven per-surface when each area is wired in slice 4.)
 *  - structural invariants (VIEWER⊆MEMBER⊆PM⊆ADMIN; CRM scope exclusivity).
 *  - resolver REPLACE semantics: inert (no assignment → baseline), grant, and
 *    RESTRICT (a smaller set actually removes access).
 *  - floor clamp (VIEWER template strips all; crm.scope.all downgrades off
 *    non-privileged templates) — can only remove, never add.
 *  - junk-key filtering + loadCustomCaps null paths (revoke/inactive/deleted/
 *    PROJECT-scope) so a revoke reverts to baseline.
 *
 * Source: apps/web/lib/capabilities/*
 */

import type { UserRole } from '@giper/db';
import { prisma } from '@giper/db';
import {
  canSeeReports,
  canSeeSettings,
  canSeeCrm,
  canEditCrm,
  canDeleteCrmPipeline,
  canSeeServiceDesk,
  canWorkTickets,
  canCreateProject,
  canViewUserTime,
} from '@/lib/permissions';
import {
  CAPABILITY_KEYS,
  BASELINE_CAPS,
  clampToFloors,
  resolveEffectiveCaps,
  loadCustomCaps,
  type CapabilityKey,
} from '@/lib/capabilities';
import { makeUser } from './helpers/factories';

const ROLES: UserRole[] = ['ADMIN', 'PM', 'MEMBER', 'VIEWER'];
const u = (role: UserRole) => ({ id: 'u', role });

describe('capabilities — golden parity with live helpers', () => {
  // Each pure-role helper anchors its capability key to runtime truth.
  const HELPER_PARITY: { key: CapabilityKey; fn: (user: { id: string; role: UserRole }) => boolean }[] = [
    { key: 'reports.view', fn: canSeeReports },
    { key: 'settings.view', fn: canSeeSettings },
    { key: 'crm.view', fn: canSeeCrm },
    { key: 'crm.edit', fn: canEditCrm },
    { key: 'crm.pipeline.destroy', fn: canDeleteCrmPipeline },
    { key: 'servicedesk.viewQueue', fn: canSeeServiceDesk },
    { key: 'servicedesk.workTickets', fn: canWorkTickets },
    { key: 'project.create', fn: canCreateProject },
    // canViewUserTime(viewer, target) is pure-role (ADMIN||PM) for a foreign target.
    { key: 'reports.viewTeamTime', fn: (user) => canViewUserTime(user, { id: 'other' }) },
  ];

  for (const role of ROLES) {
    for (const { key, fn } of HELPER_PARITY) {
      it(`${role} baseline.${key} === live helper`, () => {
        expect(BASELINE_CAPS[role].has(key)).toBe(fn(u(role)));
      });
    }
  }
});

describe('capabilities — baseline snapshot (drift trip-wire)', () => {
  // Explicit expected sets for the small, drift-prone roles. A change to
  // baseline.ts MUST also change these → the diff is visible in review. This is
  // the protection for the ~36 keys that have no exported helper to anchor.
  const EXPECTED_MEMBER: CapabilityKey[] = ['reports.view', 'servicedesk.workTickets'];
  const EXPECTED_PM: CapabilityKey[] = [
    'project.create', 'project.viewAll',
    'task.delete', 'task.staff', 'task.review.close', 'task.checklist.toggle',
    'crm.view', 'crm.edit', 'crm.scope.all',
    'servicedesk.viewQueue', 'servicedesk.workTickets',
    'reports.view', 'reports.teamScope', 'reports.viewTeamTime',
    'settings.view', 'settings.spaces.manage',
    'team.view', 'team.manageRoster',
    'integrations.bitrix24.syncTeam', 'integrations.telegram.view',
    'meetings.calendar.teamScope',
  ];
  // The exact ADMIN↛PM boundary (keys ADMIN has that PM lacks). Pins the split
  // non-tautologically — dropping/adding an admin-only key trips this.
  const EXPECTED_ADMIN_ONLY: CapabilityKey[] = [
    'project.edit',
    'task.editAny', 'task.attachments.manageAny', 'task.tags.assign',
    'crm.pipeline.destroy',
    'reports.viewScreenshots',
    'settings.users.manage', 'settings.audit.view', 'settings.groups.manage',
    'settings.positions.manage', 'settings.tags.manageOrg', 'settings.roles.manage',
    'users.create', 'users.update', 'users.resetPassword', 'users.setActive',
    'integrations.bitrix24.config', 'integrations.bitrix24.syncNow', 'integrations.telegramBots.manageAny',
    'meetings.viewAny', 'meetings.manageAny',
    'messenger.message.moderateAny',
  ];

  it('MEMBER baseline matches the snapshot exactly', () => {
    expect([...BASELINE_CAPS.MEMBER].sort()).toEqual([...EXPECTED_MEMBER].sort());
  });
  it('PM baseline matches the snapshot exactly', () => {
    expect([...BASELINE_CAPS.PM].sort()).toEqual([...EXPECTED_PM].sort());
  });
  it('ADMIN-only caps (ADMIN minus PM) match the snapshot exactly', () => {
    const adminOnly = [...BASELINE_CAPS.ADMIN].filter((k) => !BASELINE_CAPS.PM.has(k)).sort();
    expect(adminOnly).toEqual([...EXPECTED_ADMIN_ONLY].sort());
  });
});

describe('capabilities — baseline structural invariants', () => {
  it('VIEWER baseline is empty', () => {
    expect(BASELINE_CAPS.VIEWER.size).toBe(0);
  });

  it('nesting holds: VIEWER ⊆ MEMBER ⊆ PM ⊆ ADMIN', () => {
    const subset = (a: ReadonlySet<CapabilityKey>, b: ReadonlySet<CapabilityKey>) =>
      [...a].every((k) => b.has(k));
    expect(subset(BASELINE_CAPS.VIEWER, BASELINE_CAPS.MEMBER)).toBe(true);
    expect(subset(BASELINE_CAPS.MEMBER, BASELINE_CAPS.PM)).toBe(true);
    expect(subset(BASELINE_CAPS.PM, BASELINE_CAPS.ADMIN)).toBe(true);
  });

  it('ADMIN baseline = every catalog key except crm.scope.own', () => {
    const expected = CAPABILITY_KEYS.filter((k) => k !== 'crm.scope.own');
    expect([...BASELINE_CAPS.ADMIN].sort()).toEqual([...expected].sort());
    expect(BASELINE_CAPS.ADMIN.has('crm.scope.own')).toBe(false);
    expect(BASELINE_CAPS.ADMIN.has('crm.scope.all')).toBe(true);
  });

  it('CRM scope is mutually exclusive in every baseline; own is never a baseline cap', () => {
    for (const role of ROLES) {
      const s = BASELINE_CAPS[role];
      expect(s.has('crm.scope.own') && s.has('crm.scope.all')).toBe(false);
      expect(s.has('crm.scope.own')).toBe(false);
    }
    expect(BASELINE_CAPS.PM.has('crm.scope.all')).toBe(true);
  });
});

describe('capabilities — resolver REPLACE semantics', () => {
  it('no assignment → baseline (inert), source baseline', () => {
    for (const role of ROLES) {
      const eff = resolveEffectiveCaps(u(role), null);
      expect(eff.source).toBe('baseline');
      for (const k of CAPABILITY_KEYS) expect(eff.has(k)).toBe(BASELINE_CAPS[role].has(k));
    }
  });

  it('GRANT: a MEMBER-based role adds caps the MEMBER baseline lacks', () => {
    const eff = resolveEffectiveCaps(u('MEMBER'), {
      caps: new Set<CapabilityKey>(['crm.view', 'crm.scope.own', 'reports.teamScope']),
      baseRole: 'MEMBER',
      roleId: 'r1',
    });
    expect(eff.source).toBe('custom');
    expect(eff.has('crm.view')).toBe(true);
    expect(eff.has('reports.teamScope')).toBe(true);
    // crm.scope.own survives the floor clamp for a MEMBER base (only .all downgrades).
    expect(eff.has('crm.scope.own')).toBe(true);
    // and ONLY the granted caps — replace, not union with MEMBER baseline.
    expect(eff.has('reports.view')).toBe(false); // MEMBER baseline had it; replace dropped it
  });

  it('RESTRICT: a PM-based role that omits a cap actually loses it', () => {
    const restricted = [...BASELINE_CAPS.PM].filter((k) => k !== 'settings.view');
    const eff = resolveEffectiveCaps(u('PM'), {
      caps: new Set(restricted),
      baseRole: 'PM',
      roleId: 'r2',
    });
    expect(eff.has('settings.view')).toBe(false); // PM baseline has it; restricted role doesn't
    expect(eff.has('crm.view')).toBe(true); // still present
  });
});

describe('capabilities — floor clamp can only remove', () => {
  it('VIEWER-templated role is stripped of every org capability', () => {
    const greedy = new Set<CapabilityKey>(['crm.view', 'settings.view', 'reports.view', 'task.delete']);
    const clamped = clampToFloors(greedy, 'VIEWER');
    expect(clamped.size).toBe(0);
    const eff = resolveEffectiveCaps(u('VIEWER'), { caps: greedy, baseRole: 'VIEWER', roleId: 'r3' });
    for (const k of CAPABILITY_KEYS) expect(eff.has(k)).toBe(false);
  });

  it('crm.scope.all downgrades to own off a non-privileged template; clamp keeps owner scope', () => {
    const clamped = clampToFloors(new Set<CapabilityKey>(['crm.view', 'crm.scope.all']), 'MEMBER');
    expect(clamped.has('crm.scope.all')).toBe(false);
    expect(clamped.has('crm.scope.own')).toBe(true);
    // ADMIN and PM templates BOTH keep org-wide (both arms of the gate tested).
    for (const base of ['ADMIN', 'PM'] as const) {
      const kept = clampToFloors(new Set<CapabilityKey>(['crm.scope.all']), base);
      expect(kept.has('crm.scope.all')).toBe(true);
      expect(kept.has('crm.scope.own')).toBe(false);
    }
  });
});

describe('capabilities — DB resolver (loadCustomCaps)', () => {
  async function makeRole(opts: { capabilities: CapabilityKey[]; baseRole?: UserRole; isActive?: boolean; deleted?: boolean; scope?: 'ORG' | 'PROJECT' }) {
    return prisma.customRole.create({
      data: {
        name: 'role-' + Math.round(performance.now() * 1000),
        capabilities: opts.capabilities,
        baseRole: opts.baseRole ?? 'MEMBER',
        isActive: opts.isActive ?? true,
        deletedAt: opts.deleted ? new Date() : null,
        scope: opts.scope ?? 'ORG',
      },
      select: { id: true },
    });
  }

  it('returns null when the user has no assignment (→ baseline)', async () => {
    const user = await makeUser({ role: 'MEMBER' });
    expect(await loadCustomCaps(user.id)).toBeNull();
  });

  it('returns caps + baseRole for an active ORG assignment, dropping junk keys', async () => {
    const user = await makeUser({ role: 'MEMBER' });
    const role = await makeRole({ capabilities: ['crm.view', 'reports.view'], baseRole: 'PM' });
    // Inject a junk key directly to prove the resolver filters it.
    await prisma.customRole.update({ where: { id: role.id }, data: { capabilities: ['crm.view', 'reports.view', 'totally.bogus'] } });
    await prisma.userCustomRole.create({ data: { userId: user.id, customRoleId: role.id } });

    const raw = await loadCustomCaps(user.id);
    expect(raw).not.toBeNull();
    expect(raw!.baseRole).toBe('PM');
    expect([...raw!.caps].sort()).toEqual(['crm.view', 'reports.view']); // bogus dropped
  });

  it('returns null for inactive / soft-deleted / PROJECT-scope roles (revoke reverts to baseline)', async () => {
    const inactive = await makeUser({ role: 'MEMBER' });
    const r1 = await makeRole({ capabilities: ['crm.view'], isActive: false });
    await prisma.userCustomRole.create({ data: { userId: inactive.id, customRoleId: r1.id } });
    expect(await loadCustomCaps(inactive.id)).toBeNull();

    const deleted = await makeUser({ role: 'MEMBER' });
    const r2 = await makeRole({ capabilities: ['crm.view'], deleted: true });
    await prisma.userCustomRole.create({ data: { userId: deleted.id, customRoleId: r2.id } });
    expect(await loadCustomCaps(deleted.id)).toBeNull();

    const proj = await makeUser({ role: 'MEMBER' });
    const r3 = await makeRole({ capabilities: ['crm.view'], scope: 'PROJECT' });
    await prisma.userCustomRole.create({ data: { userId: proj.id, customRoleId: r3.id } });
    expect(await loadCustomCaps(proj.id)).toBeNull();
  });
});
