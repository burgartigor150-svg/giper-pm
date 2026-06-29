import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression guards for the cross-project IDOR / access-control holes found in
 * the 2026-06-29 full-project audit (.claude/plans/audit-findings.md):
 *   - addDependencyAction must not link to (and thereby leak) an invisible task
 *   - deleteTagAction must not delete another project's tag
 *   - updateRecurringTasksAction must not overwrite another project's row by id
 *   - removeProjectMember must drop the removed user's TaskWatcher rows
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
import { addDependencyAction } from '@/actions/dependencies';
import { deleteTagAction } from '@/actions/tags';
import { updateRecurringTasksAction, type RecurringTaskInput } from '@/actions/recurringTasks';
import { removeProjectMember } from '@/lib/projects/addMember';
import { makeUser, makeProject, makeTask, addMember, sessionUser } from './helpers/factories';

function as(user: { id: string; role: 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER' }) {
  mockMe.id = user.id;
  mockMe.role = user.role;
}

beforeEach(() => {
  mockMe.role = 'ADMIN';
});

describe('addDependencyAction — cross-project visibility (IDOR)', () => {
  it('refuses to link to a task the actor cannot see (no foreign-task leak)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const a = await makeProject({ ownerId: admin.id, key: 'IDORA' });
    const b = await makeProject({ ownerId: admin.id, key: 'IDORB' });
    // A plain member of A only — no stake in B, B is native → can't view B's tasks.
    const member = await makeUser({ role: 'MEMBER' });
    await addMember(a.id, member.id, 'CONTRIBUTOR');
    const mine = await makeTask({ projectId: a.id, creatorId: member.id });
    const foreign = await makeTask({ projectId: b.id, creatorId: admin.id });
    as(member);

    const res = await addDependencyAction(mine.id, foreign.id, a.key, mine.number);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_FOUND');
    expect(await prisma.taskDependency.count({ where: { fromTaskId: mine.id } })).toBe(0);
  });

  it('allows linking to a visible same-project task', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const a = await makeProject({ ownerId: admin.id, key: 'IDOROK' });
    const t1 = await makeTask({ projectId: a.id, creatorId: admin.id });
    const t2 = await makeTask({ projectId: a.id, creatorId: admin.id });
    as(admin);

    const res = await addDependencyAction(t1.id, t2.id, a.key, t1.number, 'RELATES_TO');
    expect(res.ok).toBe(true);
    expect(await prisma.taskDependency.count({ where: { fromTaskId: t1.id, toTaskId: t2.id } })).toBe(1);
  });
});

describe('deleteTagAction — project scoping', () => {
  it('a project owner cannot delete another project\'s tag', async () => {
    // Non-admin owners (no settings.tags.manageOrg cap) are project-scoped.
    const ownerA = await makeUser({ role: 'MEMBER' });
    const ownerB = await makeUser({ role: 'MEMBER' });
    const a = await makeProject({ ownerId: ownerA.id, key: 'TAGA' });
    const b = await makeProject({ ownerId: ownerB.id, key: 'TAGB' });
    const tagB = await prisma.tag.create({ data: { projectId: b.id, name: 'B-only', slug: 'b-only' } });
    as(ownerA);

    const res = await deleteTagAction(a.id, tagB.id);
    // Action returns ok (scoped deleteMany is a no-op), but B's tag survives.
    expect(await prisma.tag.findUnique({ where: { id: tagB.id } })).not.toBeNull();
    void res;
  });
});

describe('updateRecurringTasksAction — project scoping', () => {
  it('a foreign recurring-task id is not overwritten — it becomes a new row in THIS project', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const a = await makeProject({ ownerId: admin.id, key: 'RECA' });
    const b = await makeProject({ ownerId: admin.id, key: 'RECB' });
    const foreign = await prisma.recurringTask.create({
      data: {
        projectId: b.id,
        title: 'B original',
        type: 'TASK',
        priority: 'MEDIUM',
        intervalDays: 7,
        nextRunAt: new Date('2030-01-01T06:00:00Z'),
        active: true,
        createdById: admin.id,
      },
    });
    as(admin);

    const row: RecurringTaskInput = {
      id: foreign.id, // crafted: points at B's row
      title: 'HIJACK',
      type: 'TASK',
      priority: 'URGENT',
      intervalDays: 1,
      startDate: '2030-02-02',
      active: true,
    };
    const res = await updateRecurringTasksAction(a.id, [row]);
    expect(res.ok).toBe(true);
    // B's row is untouched...
    const after = await prisma.recurringTask.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(after.title).toBe('B original');
    expect(after.projectId).toBe(b.id);
    // ...and a brand-new row was created in A instead.
    const inA = await prisma.recurringTask.findMany({ where: { projectId: a.id } });
    expect(inA).toHaveLength(1);
    expect(inA[0]!.title).toBe('HIJACK');
    expect(inA[0]!.id).not.toBe(foreign.id);
  });
});

describe('removeProjectMember — drops passive access', () => {
  it('deletes the removed user\'s TaskWatcher rows for the project', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: owner.id, key: 'RMW' });
    const member = await makeUser({ role: 'MEMBER' });
    await addMember(p.id, member.id, 'CONTRIBUTOR');
    const task = await makeTask({ projectId: p.id, creatorId: owner.id });
    await prisma.taskWatcher.create({ data: { taskId: task.id, userId: member.id } });
    expect(await prisma.taskWatcher.count({ where: { userId: member.id } })).toBe(1);

    await removeProjectMember(p.id, member.id, sessionUser(owner));

    expect(await prisma.taskWatcher.count({ where: { userId: member.id } })).toBe(0);
    expect(await prisma.projectMember.count({ where: { projectId: p.id, userId: member.id } })).toBe(0);
  });
});
