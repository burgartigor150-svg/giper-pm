import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Components (Jira-port #6). CRUD gates (canEditProject), setTaskComponent gate +
 * cross-project guard, lead resolution, SetNull-keeps-cards, count, and the
 * component filter preserving the per-stake clause.
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
  createComponentAction,
  updateComponentAction,
  deleteComponentAction,
  setTaskComponentAction,
} from '@/actions/components';
import { listComponentsForProject } from '@/lib/components/listComponentsForProject';
import { listTasksForProject } from '@/lib/tasks';
import { makeUser, makeProject, addMember, makeTask } from './helpers/factories';

function as(u: { id: string; role: 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER' }) {
  mockMe.id = u.id;
  mockMe.role = u.role;
}
beforeEach(() => {
  mockMe.role = 'ADMIN';
});

describe('components — CRUD + gates', () => {
  it('owner creates (with a lead); rename; delete keeps cards (SetNull)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const lead = await makeUser({ role: 'MEMBER' });
    const p = await makeProject({ ownerId: admin.id, key: 'CMPA' });
    await addMember(p.id, lead.id, 'CONTRIBUTOR');
    as(admin);

    const created = await createComponentAction({ projectKey: p.key, name: 'Frontend', leadId: lead.id });
    expect(created.ok).toBe(true);
    const id = created.ok ? created.data!.id : '';
    expect((await prisma.component.findUniqueOrThrow({ where: { id } })).leadId).toBe(lead.id);

    const task = await makeTask({ projectId: p.id, creatorId: admin.id });
    await setTaskComponentAction(task.id, id);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).componentId).toBe(id);

    expect((await updateComponentAction(id, { name: 'UI', leadId: null })).ok).toBe(true);
    const upd = await prisma.component.findUniqueOrThrow({ where: { id } });
    expect(upd.name).toBe('UI');
    expect(upd.leadId).toBeNull();

    await deleteComponentAction(id);
    expect(await prisma.component.findUnique({ where: { id } })).toBeNull();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).componentId).toBeNull();
  });

  it('a plain member cannot create; a LEAD can; an outsider is view-floored', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'CMPB' });
    const member = await makeUser({ role: 'MEMBER' });
    const lead = await makeUser({ role: 'MEMBER' });
    const outsider = await makeUser({ role: 'MEMBER' });
    await addMember(p.id, member.id, 'CONTRIBUTOR');
    await addMember(p.id, lead.id, 'LEAD');

    as(member);
    expect((await createComponentAction({ projectKey: p.key, name: 'Нельзя' })).ok).toBe(false);
    as(lead);
    expect((await createComponentAction({ projectKey: p.key, name: 'Можно' })).ok).toBe(true);
    as(outsider);
    expect((await createComponentAction({ projectKey: p.key, name: 'Чужой' })).ok).toBe(false);
  });

  it('an invalid lead id is stored as null (graceful, FK-safe)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'CMPC' });
    as(admin);
    const r = await createComponentAction({ projectKey: p.key, name: 'Backend', leadId: 'no-such-user' });
    expect(r.ok).toBe(true);
    expect((await prisma.component.findUniqueOrThrow({ where: { id: r.ok ? r.data!.id : '' } })).leadId).toBeNull();
  });
});

describe('components — setTaskComponent + count + filter', () => {
  it('rejects a component from another project; count reflects assignments', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'CMPD' });
    const q = await makeProject({ ownerId: admin.id, key: 'CMPE' });
    as(admin);
    const cP = await createComponentAction({ projectKey: p.key, name: 'P-cmp' });
    const cQ = await createComponentAction({ projectKey: q.key, name: 'Q-cmp' });
    const cpId = cP.ok ? cP.data!.id : '';
    const cqId = cQ.ok ? cQ.data!.id : '';

    const t1 = await makeTask({ projectId: p.id, creatorId: admin.id });
    const t2 = await makeTask({ projectId: p.id, creatorId: admin.id });
    expect((await setTaskComponentAction(t1.id, cqId)).ok).toBe(false); // cross-project
    expect((await setTaskComponentAction(t1.id, cpId)).ok).toBe(true);
    expect((await setTaskComponentAction(t2.id, cpId)).ok).toBe(true);

    const rows = await listComponentsForProject(p.id);
    expect(rows.find((r) => r.id === cpId)!.taskCount).toBe(2);
    void cqId;
  });

  it('component filter narrows the list AND keeps the per-stake clause (no leak)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'CMPF' });
    const rep = await makeUser({ role: 'MEMBER' });
    await addMember(p.id, rep.id, 'CONTRIBUTOR');
    as(admin);
    const c = await createComponentAction({ projectKey: p.key, name: 'Фильтр-компонент' });
    const cId = c.ok ? c.data!.id : '';

    const mine = await makeTask({ projectId: p.id, creatorId: admin.id, assigneeId: rep.id });
    await prisma.task.update({ where: { id: mine.id }, data: { componentId: cId } });
    const notMine = await makeTask({ projectId: p.id, creatorId: admin.id });
    await prisma.task.update({ where: { id: notMine.id }, data: { componentId: cId } });

    const res = await listTasksForProject(
      p.key,
      { componentId: cId, page: 1, sort: 'number', dir: 'desc' },
      { id: rep.id, role: 'MEMBER' },
    );
    const ids = res.items.map((i) => i.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(notMine.id);
  });
});
