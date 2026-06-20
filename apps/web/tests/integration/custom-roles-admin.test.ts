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
import { loadCustomCaps } from '@/lib/capabilities';
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

  it('rejects assigning a non-existent role (NOT_FOUND)', async () => {
    await asAdmin();
    const user = await makeUser({ role: 'MEMBER' });
    const res = await assignCustomRoleAction(user.id, 'does-not-exist');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_FOUND');
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
