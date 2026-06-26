import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Sprint planning actions (add/remove tasks from a sprint in one place).
 * - listSprintPlanningTasksAction: visible project tasks + inSprint flag + search.
 * - updateSprintMembershipAction: per-task gated add/remove, cross-project sprint
 *   rejected, validation.
 * Source: actions/sprints.ts.
 */

const mockMe = {
  id: '',
  role: 'ADMIN' as 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER',
  name: 'A',
  email: 'a@a',
  image: null,
  mustChangePassword: false,
};

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => mockMe),
  requireRole: vi.fn(async () => mockMe),
  signOut: vi.fn(),
  signIn: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@giper/db';
import {
  listSprintPlanningTasksAction,
  updateSprintMembershipAction,
} from '@/actions/sprints';
import { makeUser, makeProject, addMember, makeTask } from './helpers/factories';

beforeEach(() => {
  mockMe.role = 'ADMIN';
});

const sprintOf = (projectId: string, name = 'S') =>
  prisma.sprint.create({ data: { projectId, name } });

describe('listSprintPlanningTasksAction', () => {
  it('returns the project tasks with the inSprint flag set for the given sprint', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const p = await makeProject({ ownerId: admin.id, key: 'SPLA' });
    const sprint = await sprintOf(p.id);
    const inSprint = await makeTask({ projectId: p.id, creatorId: admin.id });
    const backlog = await makeTask({ projectId: p.id, creatorId: admin.id });
    await prisma.task.update({ where: { id: inSprint.id }, data: { sprintId: sprint.id } });

    const res = await listSprintPlanningTasksAction(p.key, sprint.id, '');
    expect(res.ok).toBe(true);
    if (!res.ok || !res.data) throw new Error('no data');
    const byId = new Map(res.data.items.map((t) => [t.id, t]));
    expect(byId.get(inSprint.id)?.inSprint).toBe(true);
    expect(byId.get(backlog.id)?.inSprint).toBe(false);
  });

  it('filters by the search query', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const p = await makeProject({ ownerId: admin.id, key: 'SPLB' });
    const sprint = await sprintOf(p.id);
    await makeTask({ projectId: p.id, creatorId: admin.id, title: 'Уникальное-имя-задачи' });
    await makeTask({ projectId: p.id, creatorId: admin.id, title: 'Другое' });

    const res = await listSprintPlanningTasksAction(p.key, sprint.id, 'Уникальное-имя');
    expect(res.ok).toBe(true);
    if (!res.ok || !res.data) throw new Error('no data');
    expect(res.data.items).toHaveLength(1);
    expect(res.data.items[0]?.title).toBe('Уникальное-имя-задачи');
  });
});

describe('updateSprintMembershipAction', () => {
  it('adds and removes tasks from the sprint', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const p = await makeProject({ ownerId: admin.id, key: 'SPLC' });
    const sprint = await sprintOf(p.id);
    const a = await makeTask({ projectId: p.id, creatorId: admin.id });
    const b = await makeTask({ projectId: p.id, creatorId: admin.id });
    await prisma.task.update({ where: { id: b.id }, data: { sprintId: sprint.id } });

    // add a, remove b
    const res = await updateSprintMembershipAction(sprint.id, [a.id], [b.id]);
    expect(res.ok).toBe(true);
    if (res.ok && res.data) {
      expect(res.data.added).toBe(1);
      expect(res.data.removed).toBe(1);
      expect(res.data.failed).toBe(0);
    }
    expect((await prisma.task.findUniqueOrThrow({ where: { id: a.id } })).sprintId).toBe(sprint.id);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: b.id } })).sprintId).toBeNull();
  });

  it('PER-ITEM: a task the caller cannot edit is skipped, not added', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'SPLD' });
    const sprint = await sprintOf(p.id);
    const member = await makeUser({ role: 'MEMBER' });
    await addMember(p.id, member.id, 'CONTRIBUTOR');
    const foreignTask = await makeTask({ projectId: p.id, creatorId: admin.id }); // member has no stake
    mockMe.id = member.id;
    mockMe.role = 'MEMBER';

    const res = await updateSprintMembershipAction(sprint.id, [foreignTask.id], []);
    expect(res.ok).toBe(true);
    if (res.ok && res.data) expect(res.data.failed).toBe(1);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: foreignTask.id } })).sprintId).toBeNull();
  });

  it('rejects a sprint from another project (cross-project hardening)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const p = await makeProject({ ownerId: admin.id, key: 'SPLE' });
    const other = await makeProject({ ownerId: admin.id, key: 'SPLF' });
    const foreignSprint = await sprintOf(other.id);
    const task = await makeTask({ projectId: p.id, creatorId: admin.id });

    const res = await updateSprintMembershipAction(foreignSprint.id, [task.id], []);
    expect(res.ok).toBe(true);
    if (res.ok && res.data) expect(res.data.failed).toBe(1);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).sprintId).toBeNull();
  });

  it('validates empty changes and oversize batches', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const p = await makeProject({ ownerId: admin.id, key: 'SPLG' });
    const sprint = await sprintOf(p.id);

    expect((await updateSprintMembershipAction(sprint.id, [], [])).ok).toBe(false);
    const huge = await updateSprintMembershipAction(
      sprint.id,
      Array.from({ length: 201 }, (_, i) => `id${i}`),
      [],
    );
    expect(huge.ok).toBe(false);
  });

  it('de-dupes: an id in both add and remove is treated as add', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const p = await makeProject({ ownerId: admin.id, key: 'SPLH' });
    const sprint = await sprintOf(p.id);
    const t = await makeTask({ projectId: p.id, creatorId: admin.id });

    const res = await updateSprintMembershipAction(sprint.id, [t.id], [t.id]);
    expect(res.ok).toBe(true);
    if (res.ok && res.data) {
      expect(res.data.added).toBe(1);
      expect(res.data.removed).toBe(0);
    }
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).sprintId).toBe(sprint.id);
  });
});
