import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Slice 3 — custom-role admin actions: create/update/setActive/delete +
 * assign/unassign. ADMIN-gated (fixed role, NOT a capability, so a custom role
 * can't manage roles), capability sanitization, and soft-delete-cascades-
 * unassign (holders revert to baseline). Still no enforcement wiring.
 *
 * Source: apps/web/actions/customRoles.ts, apps/web/lib/customRoles.ts
 */

const mockMe = { id: '', role: 'ADMIN' as 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER', name: 'A', email: 'a@a', image: null, mustChangePassword: false };

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => mockMe),
  requireRole: vi.fn(async () => mockMe),
  signOut: vi.fn(),
  signIn: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@giper/db';
import {
  createCustomRoleAction,
  updateCustomRoleAction,
  setCustomRoleActiveAction,
  deleteCustomRoleAction,
  assignCustomRoleAction,
} from '@/actions/customRoles';
import { listCustomRoles, getCustomRole, getUserAssignment, listAssignableRoles } from '@/lib/customRoles';
import { loadCustomCaps, resolveEffectiveCaps } from '@/lib/capabilities';
import { canSeeReports, canSeeSettings, canSeeServiceDesk } from '@/lib/permissions';
import { resolveMyCrmAccess } from '@/lib/crm';
import { makeUser } from './helpers/factories';

async function asAdmin() {
  const admin = await makeUser({ role: 'ADMIN' });
  mockMe.id = admin.id;
  mockMe.role = 'ADMIN';
  return admin;
}

beforeEach(() => {
  mockMe.role = 'ADMIN';
});

describe('custom-role admin — create & validation', () => {
  it('ADMIN creates a role; junk capability keys are dropped', async () => {
    await asAdmin();
    const res = await createCustomRoleAction({
      name: 'Аудитор',
      baseRole: 'VIEWER',
      capabilities: ['reports.view', 'totally.bogus', 'settings.view'],
    });
    expect(res.ok).toBe(true);
    const role = await getCustomRole(res.ok ? res.data!.id : '');
    expect(role).not.toBeNull();
    expect(role!.capabilities.sort()).toEqual(['reports.view', 'settings.view']); // bogus dropped
    expect(role!.baseRole).toBe('VIEWER');
  });

  it('rejects a short name (VALIDATION)', async () => {
    await asAdmin();
    const res = await createCustomRoleAction({ name: 'X', baseRole: 'MEMBER', capabilities: [] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
  });

  it('a non-ADMIN cannot create/update/delete/assign roles', async () => {
    await asAdmin();
    const created = await createCustomRoleAction({ name: 'Защита', baseRole: 'MEMBER', capabilities: ['reports.view'] });
    const id = created.ok ? created.data!.id : '';
    const victim = await makeUser({ role: 'MEMBER' });

    const pm = await makeUser({ role: 'PM' });
    mockMe.id = pm.id; mockMe.role = 'PM';
    expect((await createCustomRoleAction({ name: 'Взлом', baseRole: 'ADMIN', capabilities: [] })).ok).toBe(false);
    expect((await updateCustomRoleAction(id, { name: 'Взлом', baseRole: 'ADMIN', capabilities: [] })).ok).toBe(false);
    expect((await setCustomRoleActiveAction(id, false)).ok).toBe(false);
    expect((await deleteCustomRoleAction(id)).ok).toBe(false);
    expect((await assignCustomRoleAction(victim.id, id)).ok).toBe(false);
  });
});

describe('custom-role admin — update / activate / delete', () => {
  it('updates name + capabilities + baseRole', async () => {
    await asAdmin();
    const created = await createCustomRoleAction({ name: 'Роль1', baseRole: 'MEMBER', capabilities: ['reports.view'] });
    const id = created.ok ? created.data!.id : '';
    const upd = await updateCustomRoleAction(id, { name: 'Роль2', baseRole: 'PM', capabilities: ['crm.view', 'crm.edit'] });
    expect(upd.ok).toBe(true);
    const role = await getCustomRole(id);
    expect(role!.name).toBe('Роль2');
    expect(role!.baseRole).toBe('PM');
    expect(role!.capabilities.sort()).toEqual(['crm.edit', 'crm.view']);
  });

  it('setActive false disables → loadCustomCaps reverts an assignee to baseline', async () => {
    await asAdmin();
    const created = await createCustomRoleAction({ name: 'Роль', baseRole: 'MEMBER', capabilities: ['crm.view'] });
    const id = created.ok ? created.data!.id : '';
    const user = await makeUser({ role: 'MEMBER' });
    await assignCustomRoleAction(user.id, id);
    expect(await loadCustomCaps(user.id)).not.toBeNull();
    await setCustomRoleActiveAction(id, false);
    expect(await loadCustomCaps(user.id)).toBeNull(); // disabled → baseline
  });

  it('soft-delete unassigns holders (revert to baseline) and drops from the list', async () => {
    await asAdmin();
    const created = await createCustomRoleAction({ name: 'Удалить', baseRole: 'MEMBER', capabilities: ['crm.view'] });
    const id = created.ok ? created.data!.id : '';
    const user = await makeUser({ role: 'MEMBER' });
    await assignCustomRoleAction(user.id, id);

    const res = await deleteCustomRoleAction(id);
    expect(res.ok).toBe(true);
    expect(await getCustomRole(id)).toBeNull();
    expect(await getUserAssignment(user.id)).toBeNull();
    expect(await loadCustomCaps(user.id)).toBeNull();
    expect((await listCustomRoles()).find((r) => r.id === id)).toBeUndefined();
  });
});

describe('custom-role admin — assignment', () => {
  it('assigns, replaces (one per user), and clears', async () => {
    await asAdmin();
    const a = await createCustomRoleAction({ name: 'Роль А', baseRole: 'MEMBER', capabilities: ['reports.view'] });
    const b = await createCustomRoleAction({ name: 'Роль Б', baseRole: 'PM', capabilities: ['crm.view'] });
    const aId = a.ok ? a.data!.id : '', bId = b.ok ? b.data!.id : '';
    const user = await makeUser({ role: 'MEMBER' });

    expect((await assignCustomRoleAction(user.id, aId)).ok).toBe(true);
    expect((await getUserAssignment(user.id))?.roleId).toBe(aId);
    // Re-assign replaces (one per user — @unique userId).
    expect((await assignCustomRoleAction(user.id, bId)).ok).toBe(true);
    expect((await getUserAssignment(user.id))?.roleId).toBe(bId);
    expect(await prisma.userCustomRole.count({ where: { userId: user.id } })).toBe(1);
    // Clear.
    expect((await assignCustomRoleAction(user.id, null)).ok).toBe(true);
    expect(await getUserAssignment(user.id)).toBeNull();
  });

  it('end-to-end: assignment changes section visibility (grant + restrict)', async () => {
    const admin = await asAdmin();
    // GRANT: a VIEWER who normally sees no section gets Reports via a custom role.
    const auditor = await createCustomRoleAction({ name: 'Аудитор', baseRole: 'VIEWER', capabilities: ['reports.view'] });
    const viewer = await makeUser({ role: 'VIEWER' });
    mockMe.id = admin.id; mockMe.role = 'ADMIN';
    await assignCustomRoleAction(viewer.id, auditor.ok ? auditor.data!.id : '');
    const vCaps = resolveEffectiveCaps({ id: viewer.id, role: 'VIEWER' }, await loadCustomCaps(viewer.id));
    expect(canSeeReports({ id: viewer.id, role: 'VIEWER' }, vCaps)).toBe(true);   // granted
    expect(canSeeSettings({ id: viewer.id, role: 'VIEWER' }, vCaps)).toBe(false); // not granted

    // RESTRICT: a PM with a role that omits settings.view loses Settings.
    const limited = await createCustomRoleAction({
      name: 'ПМ без настроек',
      baseRole: 'PM',
      capabilities: ['reports.view', 'servicedesk.viewQueue'], // note: NO settings.view
    });
    const pm = await makeUser({ role: 'PM' });
    await assignCustomRoleAction(pm.id, limited.ok ? limited.data!.id : '');
    const pCaps = resolveEffectiveCaps({ id: pm.id, role: 'PM' }, await loadCustomCaps(pm.id));
    expect(canSeeSettings({ id: pm.id, role: 'PM' }, pCaps)).toBe(false);      // restricted away
    expect(canSeeServiceDesk({ id: pm.id, role: 'PM' }, pCaps)).toBe(true);    // still granted
    expect(canSeeReports({ id: pm.id, role: 'PM' }, pCaps)).toBe(true);
  });

  it('rejects assigning a non-existent role (NOT_FOUND)', async () => {
    await asAdmin();
    const user = await makeUser({ role: 'MEMBER' });
    const res = await assignCustomRoleAction(user.id, 'does-not-exist');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_FOUND');
  });

  it('CRM access resolves from custom-role caps (own via crm.view, all via scope.all)', async () => {
    const admin = await asAdmin();
    // MEMBER baseline → no CRM.
    const m = await makeUser({ role: 'MEMBER' });
    expect((await resolveMyCrmAccess({ id: m.id, role: 'MEMBER' })).canSee).toBe(false);

    // crm.view (MEMBER base) → own scope.
    const viewer = await createCustomRoleAction({ name: 'CRM смотрящий', baseRole: 'MEMBER', capabilities: ['crm.view'] });
    mockMe.id = admin.id; mockMe.role = 'ADMIN';
    await assignCustomRoleAction(m.id, viewer.ok ? viewer.data!.id : '');
    expect(await resolveMyCrmAccess({ id: m.id, role: 'MEMBER' })).toEqual({ canSee: true, scope: 'own' });

    // crm.scope.all from a PM-based role → org-wide for a MEMBER user.
    const orgRole = await createCustomRoleAction({ name: 'CRM полный', baseRole: 'PM', capabilities: ['crm.view', 'crm.scope.all'] });
    const m2 = await makeUser({ role: 'MEMBER' });
    await assignCustomRoleAction(m2.id, orgRole.ok ? orgRole.data!.id : '');
    expect(await resolveMyCrmAccess({ id: m2.id, role: 'MEMBER' })).toEqual({ canSee: true, scope: 'all' });

    // ADMIN always org-wide regardless.
    expect(await resolveMyCrmAccess({ id: admin.id, role: 'ADMIN' })).toEqual({ canSee: true, scope: 'all' });
  });

  it('listAssignableRoles returns only active roles', async () => {
    await asAdmin();
    const act = await createCustomRoleAction({ name: 'Активная', baseRole: 'MEMBER', capabilities: [] });
    const inact = await createCustomRoleAction({ name: 'Выкл', baseRole: 'MEMBER', capabilities: [] });
    await setCustomRoleActiveAction(inact.ok ? inact.data!.id : '', false);
    const ids = (await listAssignableRoles()).map((r) => r.id);
    expect(ids).toContain(act.ok ? act.data!.id : '');
    expect(ids).not.toContain(inact.ok ? inact.data!.id : '');
  });
});
