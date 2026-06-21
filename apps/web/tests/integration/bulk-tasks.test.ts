import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Bulk operations (Jira-port #2). Verifies the batch routes each task through
 * the per-task gate (so authz is per-item, a forbidden task is skipped not
 * aborted), the {succeeded, failed} tally is correct, priority edit doesn't wipe
 * tags, and the batch size / validation guards hold.
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
import { bulkUpdateTasksAction } from '@/actions/bulkTasks';
import { makeUser, makeProject, addMember, makeTask } from './helpers/factories';

function as(user: { id: string; role: 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER' }) {
  mockMe.id = user.id;
  mockMe.role = user.role;
}

beforeEach(() => {
  mockMe.role = 'ADMIN';
});

describe('bulkUpdateTasksAction', () => {
  it('admin bulk-changes status of many tasks', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'BLKA' });
    const t1 = await makeTask({ projectId: p.id, creatorId: admin.id, status: 'TODO' });
    const t2 = await makeTask({ projectId: p.id, creatorId: admin.id, status: 'TODO' });
    as(admin);

    const res = await bulkUpdateTasksAction([t1.id, t2.id], { kind: 'status', status: 'IN_PROGRESS' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.succeeded).toBe(2);
      expect(res.data.failed).toBe(0);
    }
    const after = await prisma.task.findMany({ where: { id: { in: [t1.id, t2.id] } }, select: { status: true } });
    expect(after.every((t) => t.status === 'IN_PROGRESS')).toBe(true);
  });

  it('PER-ITEM authz: a member only affects tasks they have a stake on; others are skipped', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'BLKB' });
    const member = await makeUser({ role: 'MEMBER' });
    await addMember(p.id, member.id, 'CONTRIBUTOR');
    const mine = await makeTask({ projectId: p.id, creatorId: admin.id, assigneeId: member.id, status: 'TODO' });
    const notMine = await makeTask({ projectId: p.id, creatorId: admin.id, status: 'TODO' });
    as(member);

    const res = await bulkUpdateTasksAction([mine.id, notMine.id], { kind: 'status', status: 'IN_PROGRESS' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.succeeded).toBe(1);
      expect(res.data.failed).toBe(1);
    }
    // The member's task moved; the other stayed.
    expect((await prisma.task.findUniqueOrThrow({ where: { id: mine.id } })).status).toBe('IN_PROGRESS');
    expect((await prisma.task.findUniqueOrThrow({ where: { id: notMine.id } })).status).toBe('TODO');
  });

  it('bulk assignee sets and clears the assignee', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'BLKC' });
    const victim = await makeUser({ role: 'MEMBER' });
    const t1 = await makeTask({ projectId: p.id, creatorId: admin.id });
    const t2 = await makeTask({ projectId: p.id, creatorId: admin.id });
    as(admin);

    const set = await bulkUpdateTasksAction([t1.id, t2.id], { kind: 'assignee', assigneeId: victim.id });
    expect(set.ok && set.data.succeeded).toBe(2);
    const assigned = await prisma.task.findMany({ where: { id: { in: [t1.id, t2.id] } }, select: { assigneeId: true } });
    expect(assigned.every((t) => t.assigneeId === victim.id)).toBe(true);

    const clear = await bulkUpdateTasksAction([t1.id], { kind: 'assignee', assigneeId: null });
    expect(clear.ok).toBe(true);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t1.id } })).assigneeId).toBeNull();
  });

  it('bulk priority sets priority WITHOUT wiping tags', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'BLKD' });
    const t = await makeTask({ projectId: p.id, creatorId: admin.id });
    await prisma.task.update({ where: { id: t.id }, data: { tags: ['keep'], priority: 'LOW' } });
    as(admin);

    const res = await bulkUpdateTasksAction([t.id], { kind: 'priority', priority: 'URGENT' });
    expect(res.ok && res.data.succeeded).toBe(1);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: t.id }, select: { priority: true, tags: true } });
    expect(after.priority).toBe('URGENT');
    expect(after.tags).toEqual(['keep']); // tags survived the priority-only edit
  });

  it('validates empty selection, oversize batch, and bad op', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    await makeProject({ ownerId: admin.id, key: 'BLKE' });
    as(admin);

    const empty = await bulkUpdateTasksAction([], { kind: 'status', status: 'DONE' });
    expect(empty.ok).toBe(false);

    const huge = await bulkUpdateTasksAction(
      Array.from({ length: 201 }, (_, i) => `id${i}`),
      { kind: 'status', status: 'DONE' },
    );
    expect(huge.ok).toBe(false);

    // @ts-expect-error — invalid op kind is rejected by the schema
    const bad = await bulkUpdateTasksAction(['x'], { kind: 'nope' });
    expect(bad.ok).toBe(false);

    // A non-array id list must fail closed (VALIDATION), not throw.
    const notArray = await bulkUpdateTasksAction('oops' as never, { kind: 'status', status: 'DONE' });
    expect(notArray.ok).toBe(false);
    if (!notArray.ok) expect(notArray.error.code).toBe('VALIDATION');
  });

  it('de-dupes repeated ids so a task is acted on once', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'BLKF' });
    const t = await makeTask({ projectId: p.id, creatorId: admin.id, status: 'TODO' });
    as(admin);
    const res = await bulkUpdateTasksAction([t.id, t.id, t.id], { kind: 'status', status: 'DONE' });
    expect(res.ok && res.data.succeeded).toBe(1); // counted once
  });
});
