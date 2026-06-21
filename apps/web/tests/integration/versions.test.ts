import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Versions / Releases (Jira-port #3). Verifies CRUD gates (canEditProject),
 * the RELEASED stamp, setTaskVersion gate + cross-project guard, progress
 * counts, and that the version filter narrows the list WITHOUT breaking the
 * per-stake access clause.
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
  createVersionAction,
  updateVersionAction,
  setVersionStatusAction,
  deleteVersionAction,
  setTaskVersionAction,
} from '@/actions/versions';
import { listVersionsForProject } from '@/lib/versions/listVersionsForProject';
import { listTasksForProject } from '@/lib/tasks';
import { makeUser, makeProject, addMember, makeTask } from './helpers/factories';

function as(u: { id: string; role: 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER' }) {
  mockMe.id = u.id;
  mockMe.role = u.role;
}
beforeEach(() => {
  mockMe.role = 'ADMIN';
});

describe('versions — CRUD + gates', () => {
  it('owner creates; RELEASED stamps releasedAt; delete keeps cards (SetNull)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'VERA' });
    as(admin);

    const created = await createVersionAction({ projectKey: p.key, name: 'Релиз 1.0', releaseDate: '2026-09-01' });
    expect(created.ok).toBe(true);
    const id = created.ok ? created.data!.id : '';

    const task = await makeTask({ projectId: p.id, creatorId: admin.id });
    await setTaskVersionAction(task.id, id);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).versionId).toBe(id);

    await setVersionStatusAction(id, 'RELEASED');
    const v = await prisma.version.findUniqueOrThrow({ where: { id } });
    expect(v.status).toBe('RELEASED');
    expect(v.releasedAt).not.toBeNull();

    // Delete the version → the card survives, just unversioned.
    await deleteVersionAction(id);
    expect(await prisma.version.findUnique({ where: { id } })).toBeNull();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).versionId).toBeNull();
  });

  it('a plain member cannot create/edit/delete a version; a LEAD can', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'VERB' });
    const member = await makeUser({ role: 'MEMBER' });
    const lead = await makeUser({ role: 'MEMBER' });
    await addMember(p.id, member.id, 'CONTRIBUTOR');
    await addMember(p.id, lead.id, 'LEAD');

    as(member);
    const denied = await createVersionAction({ projectKey: p.key, name: 'Нельзя' });
    expect(denied.ok).toBe(false);

    as(lead);
    const ok = await createVersionAction({ projectKey: p.key, name: 'Можно лиду' });
    expect(ok.ok).toBe(true);
    const id = ok.ok ? ok.data!.id : '';
    expect((await updateVersionAction(id, { name: 'Переименовал' })).ok).toBe(true);
    expect((await prisma.version.findUniqueOrThrow({ where: { id } })).name).toBe('Переименовал');
  });

  it('a non-member is rejected by the project view floor on create', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'VERC' });
    const outsider = await makeUser({ role: 'MEMBER' });
    as(outsider);
    expect((await createVersionAction({ projectKey: p.key, name: 'Чужой' })).ok).toBe(false);
  });
});

describe('versions — setTaskVersion + progress + filter', () => {
  it('rejects a version from another project; progress counts done cards', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'VERD' });
    const q = await makeProject({ ownerId: admin.id, key: 'VERE' });
    as(admin);
    const vP = await createVersionAction({ projectKey: p.key, name: 'P 1.0' });
    const vQ = await createVersionAction({ projectKey: q.key, name: 'Q 1.0' });
    const vpId = vP.ok ? vP.data!.id : '';
    const vqId = vQ.ok ? vQ.data!.id : '';

    const t1 = await makeTask({ projectId: p.id, creatorId: admin.id });
    const t2 = await makeTask({ projectId: p.id, creatorId: admin.id });
    // cross-project version rejected
    const bad = await setTaskVersionAction(t1.id, vqId);
    expect(bad.ok).toBe(false);
    // own-project version accepted
    expect((await setTaskVersionAction(t1.id, vpId)).ok).toBe(true);
    expect((await setTaskVersionAction(t2.id, vpId)).ok).toBe(true);
    // mark one done
    await prisma.task.update({ where: { id: t2.id }, data: { internalStatus: 'DONE' } });
    // a CANCELED card on the version must NOT count toward the denominator.
    const t3 = await makeTask({ projectId: p.id, creatorId: admin.id });
    await prisma.task.update({ where: { id: t3.id }, data: { versionId: vpId, internalStatus: 'CANCELED' } });

    const rows = await listVersionsForProject(p.id);
    const row = rows.find((r) => r.id === vpId)!;
    expect(row.taskCount).toBe(2); // t1 + t2, NOT the canceled t3
    expect(row.doneCount).toBe(1);
    void vqId;
  });

  it('version filter narrows the list AND keeps the per-stake clause (no leak)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'VERF' });
    const rep = await makeUser({ role: 'MEMBER' });
    await addMember(p.id, rep.id, 'CONTRIBUTOR');
    as(admin);
    const v = await createVersionAction({ projectKey: p.key, name: 'Фильтр-версия' });
    const vId = v.ok ? v.data!.id : '';

    // rep's own task on the version
    const mine = await makeTask({ projectId: p.id, creatorId: admin.id, assigneeId: rep.id });
    await prisma.task.update({ where: { id: mine.id }, data: { versionId: vId } });
    // admin-only task on the SAME version (rep has no stake)
    const notMine = await makeTask({ projectId: p.id, creatorId: admin.id });
    await prisma.task.update({ where: { id: notMine.id }, data: { versionId: vId } });

    const res = await listTasksForProject(
      p.key,
      { versionId: vId, page: 1, sort: 'number', dir: 'desc' },
      { id: rep.id, role: 'MEMBER' },
    );
    const ids = res.items.map((i) => i.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(notMine.id); // per-stake clause preserved under version filter
  });
});
