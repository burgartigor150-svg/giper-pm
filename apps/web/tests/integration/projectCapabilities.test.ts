import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * H7 slice 5 — per-project custom roles. Verifies the additive UNION overlay:
 * a PROJECT-scope role grants project/task caps WITHIN one project only, never
 * widens visibility, never grants org surfaces; inert until assigned; assignment
 * is gated on canEditProject + a ProjectMember floor.
 *
 * Source: lib/capabilities/projectResolve.ts, actions/customRoles.ts, lib/customRoles.ts
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
  assignProjectCustomRoleAction,
  deleteCustomRoleAction,
} from '@/actions/customRoles';
import {
  getEffectiveCaps,
  getEffectiveCapsForProject,
  loadProjectCaps,
  CAPABILITY_KEYS,
} from '@/lib/capabilities';
import { canEditProject } from '@/lib/permissions';
import { getProjectMemberAssignment } from '@/lib/customRoles';
import { updateProjectMemberRole } from '@/lib/projects';
import { changeTaskStatus } from '@/lib/tasks/changeTaskStatus';
import { updateTask } from '@/lib/tasks/updateTask';
import { deleteTask } from '@/lib/tasks/deleteTask';
import { assignTask } from '@/lib/tasks/assignTask';
import { makeUser, makeProject, addMember, makeTask } from './helpers/factories';

async function asAdmin() {
  const admin = await makeUser({ role: 'ADMIN' });
  mockMe.id = admin.id;
  mockMe.role = 'ADMIN';
  return admin;
}
/** Create a PROJECT-scope role and return its id. */
async function makeProjectRole(caps: string[], name = 'Лид проекта ' + Math.round(performance.now() * 1000)) {
  const res = await createCustomRoleAction({ name, baseRole: 'MEMBER', capabilities: caps, scope: 'PROJECT' });
  return res.ok ? res.data!.id : '';
}

beforeEach(() => {
  mockMe.role = 'ADMIN';
});

describe('per-project caps — resolver', () => {
  it('inert: zero assignments → getEffectiveCapsForProject == org caps for every key', async () => {
    const admin = await asAdmin();
    const project = await makeProject({ ownerId: admin.id, key: 'INRT' });
    const member = await makeUser({ role: 'MEMBER' });
    const eff = await getEffectiveCapsForProject({ id: member.id, role: 'MEMBER' }, project.id);
    const org = await getEffectiveCaps({ id: member.id, role: 'MEMBER' });
    for (const k of CAPABILITY_KEYS) expect(eff.has(k)).toBe(org.has(k));
  });

  it('in-project grant: role caps apply in project P, not in project Q', async () => {
    const admin = await asAdmin();
    const p = await makeProject({ ownerId: admin.id, key: 'PRJP' });
    const q = await makeProject({ ownerId: admin.id, key: 'PRJQ' });
    const rep = await makeUser({ role: 'MEMBER' });
    await addMember(p.id, rep.id);
    const roleId = await makeProjectRole(['project.edit', 'task.staff']);
    mockMe.id = admin.id; mockMe.role = 'ADMIN';
    await assignProjectCustomRoleAction(p.id, rep.id, roleId, p.key);

    const inP = await getEffectiveCapsForProject({ id: rep.id, role: 'MEMBER' }, p.id);
    expect(inP.has('project.edit')).toBe(true);
    expect(inP.has('task.staff')).toBe(true);
    const inQ = await getEffectiveCapsForProject({ id: rep.id, role: 'MEMBER' }, q.id);
    expect(inQ.has('project.edit')).toBe(false); // no org-wide leak across projects

    // canEditProject honors it in P (rep is not owner/LEAD) but not in Q.
    const projShape = { ownerId: p.ownerId, members: [{ userId: rep.id, role: 'CONTRIBUTOR' as const }] };
    expect(canEditProject({ id: rep.id, role: 'MEMBER' }, projShape, inP)).toBe(true);
    expect(canEditProject({ id: rep.id, role: 'MEMBER' }, { ownerId: q.ownerId, members: [] }, inQ)).toBe(false);
  });

  it('cannot grant org surfaces: a smuggled org key is dropped at write + resolve + merge', async () => {
    const admin = await asAdmin();
    const p = await makeProject({ ownerId: admin.id, key: 'ORGX' });
    const rep = await makeUser({ role: 'MEMBER' });
    await addMember(p.id, rep.id);
    // Write filter: createCustomRoleAction(scope PROJECT) strips non-project keys.
    const roleId = await makeProjectRole(['project.edit', 'settings.users.manage', 'crm.view']);
    const role = await prisma.customRole.findUniqueOrThrow({ where: { id: roleId } });
    expect(role.capabilities.sort()).toEqual(['project.edit']);
    // Even if a tampered row had org keys, the resolver intersects to the subset.
    await prisma.customRole.update({ where: { id: roleId }, data: { capabilities: ['project.edit', 'settings.users.manage'] } });
    mockMe.id = admin.id; mockMe.role = 'ADMIN';
    await assignProjectCustomRoleAction(p.id, rep.id, roleId, p.key);
    const proj = await loadProjectCaps(rep.id, p.id);
    expect([...proj]).toEqual(['project.edit']); // settings.users.manage dropped
    const eff = await getEffectiveCapsForProject({ id: rep.id, role: 'MEMBER' }, p.id);
    expect(eff.has('settings.users.manage')).toBe(false); // merge guard: org-only for non-subset keys
  });

  it('soft-deleted / inactive / wrong-scope / fault → empty project caps', async () => {
    const admin = await asAdmin();
    const p = await makeProject({ ownerId: admin.id, key: 'NUL' });
    const rep = await makeUser({ role: 'MEMBER' });
    await addMember(p.id, rep.id);
    const roleId = await makeProjectRole(['project.edit']);
    mockMe.id = admin.id; mockMe.role = 'ADMIN';
    await assignProjectCustomRoleAction(p.id, rep.id, roleId, p.key);
    expect((await loadProjectCaps(rep.id, p.id)).size).toBe(1);
    // Disable → empty.
    await prisma.customRole.update({ where: { id: roleId }, data: { isActive: false } });
    expect((await loadProjectCaps(rep.id, p.id)).size).toBe(0);
  });
});

describe('per-project caps — assignment authz & floor', () => {
  it('requires the assignee to be a project member (NOT_A_MEMBER otherwise)', async () => {
    const admin = await asAdmin();
    const p = await makeProject({ ownerId: admin.id, key: 'FLR' });
    const outsider = await makeUser({ role: 'MEMBER' }); // NOT a member
    const roleId = await makeProjectRole(['project.edit']);
    mockMe.id = admin.id; mockMe.role = 'ADMIN';
    const res = await assignProjectCustomRoleAction(p.id, outsider.id, roleId, p.key);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_A_MEMBER');
  });

  it('a project LEAD (not admin) can assign; a plain member cannot', async () => {
    const admin = await asAdmin();
    const p = await makeProject({ ownerId: admin.id, key: 'LEAD' });
    const lead = await makeUser({ role: 'MEMBER' });
    const plain = await makeUser({ role: 'MEMBER' });
    const target = await makeUser({ role: 'MEMBER' });
    await addMember(p.id, lead.id, 'LEAD');
    await addMember(p.id, plain.id, 'CONTRIBUTOR');
    await addMember(p.id, target.id, 'CONTRIBUTOR');
    const roleId = await makeProjectRole(['task.staff']);

    mockMe.id = lead.id; mockMe.role = 'MEMBER';
    expect((await assignProjectCustomRoleAction(p.id, target.id, roleId, p.key)).ok).toBe(true);

    mockMe.id = plain.id; mockMe.role = 'MEMBER';
    const denied = await assignProjectCustomRoleAction(p.id, target.id, roleId, p.key);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('NO self-escalation: a member with per-project project.edit cannot promote self to LEAD', async () => {
    const admin = await asAdmin();
    const p = await makeProject({ ownerId: admin.id, key: 'ESC' });
    const member = await makeUser({ role: 'MEMBER' });
    await addMember(p.id, member.id, 'CONTRIBUTOR');
    // Grant the member a per-project role WITH project.edit.
    const roleId = await makeProjectRole(['project.edit']);
    mockMe.id = admin.id; mockMe.role = 'ADMIN';
    await assignProjectCustomRoleAction(p.id, member.id, roleId, p.key);

    // The member tries to make THEMSELVES a LEAD. Member-management is org-gated,
    // so the per-project project.edit must NOT authorize it.
    await expect(
      updateProjectMemberRole(p.id, member.id, 'LEAD', { id: member.id, role: 'MEMBER' }),
    ).rejects.toThrow();
    const row = await prisma.projectMember.findFirstOrThrow({ where: { projectId: p.id, userId: member.id } });
    expect(row.role).toBe('CONTRIBUTOR'); // unchanged
  });

  it('only PROJECT-scope roles are assignable per-project (ORG role → NOT_FOUND)', async () => {
    const admin = await asAdmin();
    const p = await makeProject({ ownerId: admin.id, key: 'ORGR' });
    const member = await makeUser({ role: 'MEMBER' });
    await addMember(p.id, member.id);
    const orgRole = await createCustomRoleAction({ name: 'Орг роль', baseRole: 'PM', capabilities: ['crm.view'] });
    mockMe.id = admin.id; mockMe.role = 'ADMIN';
    const res = await assignProjectCustomRoleAction(p.id, member.id, orgRole.ok ? orgRole.data!.id : '', p.key);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_FOUND');
  });

  it('upsert/replace/clear + soft-delete cleanup', async () => {
    const admin = await asAdmin();
    const p = await makeProject({ ownerId: admin.id, key: 'UPS' });
    const member = await makeUser({ role: 'MEMBER' });
    await addMember(p.id, member.id);
    const r1 = await makeProjectRole(['project.edit']);
    const r2 = await makeProjectRole(['task.delete']);
    mockMe.id = admin.id; mockMe.role = 'ADMIN';

    await assignProjectCustomRoleAction(p.id, member.id, r1, p.key);
    expect((await getProjectMemberAssignment(p.id, member.id))?.roleId).toBe(r1);
    await assignProjectCustomRoleAction(p.id, member.id, r2, p.key); // replace
    expect((await getProjectMemberAssignment(p.id, member.id))?.roleId).toBe(r2);
    expect(await prisma.projectMemberCustomRole.count({ where: { projectId: p.id, userId: member.id } })).toBe(1);
    // Soft-deleting the role clears its per-project assignments.
    await deleteCustomRoleAction(r2);
    expect(await getProjectMemberAssignment(p.id, member.id)).toBeNull();
    await assignProjectCustomRoleAction(p.id, member.id, r1, p.key);
    expect((await getProjectMemberAssignment(p.id, member.id))?.roleId).toBe(r1);
    // Clear.
    await assignProjectCustomRoleAction(p.id, member.id, null, p.key);
    expect(await getProjectMemberAssignment(p.id, member.id)).toBeNull();
  });
});

/**
 * Slice 5c (Tier B) — the deep task-lib helpers now honor per-project caps.
 * These previously gated on role only (denying any custom-role holder). Each
 * test grants the cap to `rep` and checks the action succeeds, while a SEPARATE
 * ungranted member is still denied (distinct caps-cache args, so no reliance on
 * cache() invalidation semantics), plus cross-project isolation.
 */
describe('per-project caps — task-lib helpers (slice 5c)', () => {
  it('changeTaskStatus: per-project task.editAny moves a card; ungranted denied; isolated to project', async () => {
    const admin = await asAdmin();
    const p = await makeProject({ ownerId: admin.id, key: 'T5CA' });
    const q = await makeProject({ ownerId: admin.id, key: 'T5CB' });
    const rep = await makeUser({ role: 'MEMBER' });
    const other = await makeUser({ role: 'MEMBER' });
    await addMember(p.id, rep.id, 'CONTRIBUTOR');
    await addMember(p.id, other.id, 'CONTRIBUTOR');
    await addMember(q.id, rep.id, 'CONTRIBUTOR');
    const taskP = await makeTask({ projectId: p.id, creatorId: admin.id, status: 'TODO' });
    const taskP2 = await makeTask({ projectId: p.id, creatorId: admin.id, status: 'TODO' });
    const taskQ = await makeTask({ projectId: q.id, creatorId: admin.id, status: 'TODO' });

    const roleId = await makeProjectRole(['task.editAny']);
    mockMe.id = admin.id; mockMe.role = 'ADMIN';
    await assignProjectCustomRoleAction(p.id, rep.id, roleId, p.key);

    // Granted rep moves the card in P.
    const moved = await changeTaskStatus(taskP.id, 'IN_PROGRESS', { id: rep.id, role: 'MEMBER' });
    expect(moved.status).toBe('IN_PROGRESS');
    // Ungranted member (also a contributor, not creator/assignee) is denied.
    await expect(
      changeTaskStatus(taskP2.id, 'IN_PROGRESS', { id: other.id, role: 'MEMBER' }),
    ).rejects.toThrow();
    // rep has no role in Q → cross-project isolation, denied.
    await expect(
      changeTaskStatus(taskQ.id, 'IN_PROGRESS', { id: rep.id, role: 'MEMBER' }),
    ).rejects.toThrow();
  });

  it('deleteTask: per-project task.delete authorizes a non-owner; ungranted denied', async () => {
    const admin = await asAdmin();
    const p = await makeProject({ ownerId: admin.id, key: 'T5CD' });
    const rep = await makeUser({ role: 'MEMBER' });
    const other = await makeUser({ role: 'MEMBER' });
    await addMember(p.id, rep.id, 'CONTRIBUTOR');
    await addMember(p.id, other.id, 'CONTRIBUTOR');
    const task = await makeTask({ projectId: p.id, creatorId: admin.id });
    const task2 = await makeTask({ projectId: p.id, creatorId: admin.id });

    const roleId = await makeProjectRole(['task.delete']);
    mockMe.id = admin.id; mockMe.role = 'ADMIN';
    await assignProjectCustomRoleAction(p.id, rep.id, roleId, p.key);

    await expect(deleteTask(task2.id, { id: other.id, role: 'MEMBER' })).rejects.toThrow();
    await deleteTask(task.id, { id: rep.id, role: 'MEMBER' });
    expect(await prisma.task.findUnique({ where: { id: task.id } })).toBeNull();
  });

  it('assignTask (task.staff) + updateTask (task.editAny) honored per-project; ungranted denied', async () => {
    const admin = await asAdmin();
    const p = await makeProject({ ownerId: admin.id, key: 'T5CS' });
    const rep = await makeUser({ role: 'MEMBER' });
    const other = await makeUser({ role: 'MEMBER' });
    const victim = await makeUser({ role: 'MEMBER' });
    await addMember(p.id, rep.id, 'CONTRIBUTOR');
    await addMember(p.id, other.id, 'CONTRIBUTOR');
    const task = await makeTask({ projectId: p.id, creatorId: admin.id });
    const task2 = await makeTask({ projectId: p.id, creatorId: admin.id });

    const roleId = await makeProjectRole(['task.staff', 'task.editAny']);
    mockMe.id = admin.id; mockMe.role = 'ADMIN';
    await assignProjectCustomRoleAction(p.id, rep.id, roleId, p.key);

    // Ungranted member cannot staff or edit.
    await expect(assignTask(task2.id, victim.id, { id: other.id, role: 'MEMBER' })).rejects.toThrow();
    await expect(
      updateTask(task2.id, { priority: 'HIGH' }, { id: other.id, role: 'MEMBER' }),
    ).rejects.toThrow();

    // Granted rep can.
    const assigned = await assignTask(task.id, victim.id, { id: rep.id, role: 'MEMBER' });
    expect(assigned.assigneeId).toBe(victim.id);
    const updated = await updateTask(task.id, { priority: 'HIGH' }, { id: rep.id, role: 'MEMBER' });
    expect(updated.priority).toBe('HIGH');
  });
});
