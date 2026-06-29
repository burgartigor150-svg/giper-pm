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
import { bulkUpdateTasksAction, bulkDeleteTasksAction } from '@/actions/bulkTasks';
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

describe('bulkUpdateTasksAction — tags & sprints (Jira-port #2 v2)', () => {
  it('bulk add-tag assigns a project tag to many tasks (idempotent)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'BLKTAG' });
    const tag = await prisma.tag.create({ data: { projectId: p.id, name: 'Backend', slug: 'backend' } });
    const t1 = await makeTask({ projectId: p.id, creatorId: admin.id });
    const t2 = await makeTask({ projectId: p.id, creatorId: admin.id });
    as(admin);

    const res = await bulkUpdateTasksAction([t1.id, t2.id], { kind: 'addTag', tagId: tag.id });
    expect(res.ok && res.data.succeeded).toBe(2);
    expect(await prisma.taskTag.count({ where: { tagId: tag.id } })).toBe(2);

    // Re-adding an existing link is a no-op success (no duplicate rows).
    const again = await bulkUpdateTasksAction([t1.id], { kind: 'addTag', tagId: tag.id });
    expect(again.ok && again.data.succeeded).toBe(1);
    expect(await prisma.taskTag.count({ where: { tagId: tag.id } })).toBe(2);
  });

  it('bulk remove-tag detaches a project tag from many tasks (idempotent)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'BLKRMT' });
    const tag = await prisma.tag.create({ data: { projectId: p.id, name: 'Frontend', slug: 'frontend' } });
    const t1 = await makeTask({ projectId: p.id, creatorId: admin.id });
    const t2 = await makeTask({ projectId: p.id, creatorId: admin.id });
    const t3 = await makeTask({ projectId: p.id, creatorId: admin.id }); // never tagged
    as(admin);
    await bulkUpdateTasksAction([t1.id, t2.id], { kind: 'addTag', tagId: tag.id });
    expect(await prisma.taskTag.count({ where: { tagId: tag.id } })).toBe(2);

    const res = await bulkUpdateTasksAction([t1.id, t2.id, t3.id], { kind: 'removeTag', tagId: tag.id });
    // t3 had no such tag — removal is a no-op success, not a failure.
    expect(res.ok && res.data.succeeded).toBe(3);
    expect(res.ok && res.data.failed).toBe(0);
    expect(await prisma.taskTag.count({ where: { tagId: tag.id } })).toBe(0);
  });

  it('bulk remove-tag: a tag from another project is skipped per-item', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'BLKRMX' });
    const other = await makeProject({ ownerId: admin.id, key: 'BLKRMY' });
    const foreignTag = await prisma.tag.create({ data: { projectId: other.id, name: 'Foreign2', slug: 'foreign2' } });
    const t = await makeTask({ projectId: p.id, creatorId: admin.id });
    as(admin);

    const res = await bulkUpdateTasksAction([t.id], { kind: 'removeTag', tagId: foreignTag.id });
    expect(res.ok && res.data.failed).toBe(1);
  });

  it('a tag from another project is skipped per-item (cross-project hardening)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'BLKTGA' });
    const other = await makeProject({ ownerId: admin.id, key: 'BLKTGB' });
    const foreignTag = await prisma.tag.create({ data: { projectId: other.id, name: 'Foreign', slug: 'foreign' } });
    const t = await makeTask({ projectId: p.id, creatorId: admin.id });
    as(admin);

    const res = await bulkUpdateTasksAction([t.id], { kind: 'addTag', tagId: foreignTag.id });
    expect(res.ok && res.data.failed).toBe(1);
    expect(await prisma.taskTag.count({ where: { taskId: t.id } })).toBe(0);
  });

  it('PER-ITEM authz for add-tag: a non-stakeholder member is skipped', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'BLKTGC' });
    const member = await makeUser({ role: 'MEMBER' });
    await addMember(p.id, member.id, 'CONTRIBUTOR');
    const tag = await prisma.tag.create({ data: { projectId: p.id, name: 'X', slug: 'x' } });
    const mine = await makeTask({ projectId: p.id, creatorId: admin.id, assigneeId: member.id });
    const notMine = await makeTask({ projectId: p.id, creatorId: admin.id });
    as(member);

    const res = await bulkUpdateTasksAction([mine.id, notMine.id], { kind: 'addTag', tagId: tag.id });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.succeeded).toBe(1);
      expect(res.data.failed).toBe(1);
    }
    expect(await prisma.taskTag.count({ where: { taskId: mine.id } })).toBe(1);
    expect(await prisma.taskTag.count({ where: { taskId: notMine.id } })).toBe(0);
  });

  it('bulk sprint sets and clears the sprint', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'BLKSPR' });
    const sprint = await prisma.sprint.create({ data: { projectId: p.id, name: 'S1' } });
    const t1 = await makeTask({ projectId: p.id, creatorId: admin.id });
    const t2 = await makeTask({ projectId: p.id, creatorId: admin.id });
    as(admin);

    const set = await bulkUpdateTasksAction([t1.id, t2.id], { kind: 'sprint', sprintId: sprint.id });
    expect(set.ok && set.data.succeeded).toBe(2);
    const inSprint = await prisma.task.findMany({
      where: { id: { in: [t1.id, t2.id] } },
      select: { sprintId: true },
    });
    expect(inSprint.every((t) => t.sprintId === sprint.id)).toBe(true);

    const clear = await bulkUpdateTasksAction([t1.id], { kind: 'sprint', sprintId: null });
    expect(clear.ok).toBe(true);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t1.id } })).sprintId).toBeNull();
  });

  it('a sprint from another project is skipped per-item', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'BLKSPA' });
    const other = await makeProject({ ownerId: admin.id, key: 'BLKSPB' });
    const foreignSprint = await prisma.sprint.create({ data: { projectId: other.id, name: 'Foreign' } });
    const t = await makeTask({ projectId: p.id, creatorId: admin.id });
    as(admin);

    const res = await bulkUpdateTasksAction([t.id], { kind: 'sprint', sprintId: foreignSprint.id });
    expect(res.ok && res.data.failed).toBe(1);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).sprintId).toBeNull();
  });
});

describe('bulkDeleteTasksAction', () => {
  it('admin bulk-deletes many tasks', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'BLKDEL' });
    const t1 = await makeTask({ projectId: p.id, creatorId: admin.id });
    const t2 = await makeTask({ projectId: p.id, creatorId: admin.id });
    as(admin);

    const res = await bulkDeleteTasksAction([t1.id, t2.id]);
    expect(res.ok && res.data.succeeded).toBe(2);
    expect(await prisma.task.count({ where: { id: { in: [t1.id, t2.id] } } })).toBe(0);
  });

  it('PER-ITEM: a task the caller cannot delete is skipped, not aborted', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'BLKDLB' });
    const member = await makeUser({ role: 'MEMBER' });
    await addMember(p.id, member.id, 'CONTRIBUTOR');
    // A contributor can't delete even tasks they created (delete = LEAD/owner/admin).
    const a = await makeTask({ projectId: p.id, creatorId: member.id });
    const b = await makeTask({ projectId: p.id, creatorId: admin.id });
    as(member);

    const res = await bulkDeleteTasksAction([a.id, b.id]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.failed).toBe(2);
    expect(await prisma.task.count({ where: { id: { in: [a.id, b.id] } } })).toBe(2); // both survive
  });

  it('a task with subtasks is counted failed; the batch continues', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'BLKDLC' });
    const parent = await makeTask({ projectId: p.id, creatorId: admin.id });
    const child = await makeTask({ projectId: p.id, creatorId: admin.id });
    await prisma.task.update({ where: { id: child.id }, data: { parentId: parent.id } });
    const lone = await makeTask({ projectId: p.id, creatorId: admin.id });
    as(admin);

    const res = await bulkDeleteTasksAction([parent.id, lone.id]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.succeeded).toBe(1); // lone deleted
      expect(res.data.failed).toBe(1); // parent blocked by its subtask
    }
    expect(await prisma.task.count({ where: { id: parent.id } })).toBe(1); // parent survived
    expect(await prisma.task.count({ where: { id: lone.id } })).toBe(0);
  });

  it('externally-mirrored tasks cannot be bulk-deleted', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'BLKDLD' });
    const mirror = await makeTask({ projectId: p.id, creatorId: admin.id });
    await prisma.task.update({
      where: { id: mirror.id },
      data: { externalSource: 'bitrix24', externalId: 'X1' },
    });
    as(admin);

    const res = await bulkDeleteTasksAction([mirror.id]);
    expect(res.ok && res.data.failed).toBe(1);
    expect(await prisma.task.count({ where: { id: mirror.id } })).toBe(1);
  });

  it('validates empty and oversize batches', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    await makeProject({ ownerId: admin.id, key: 'BLKDLE' });
    as(admin);
    expect((await bulkDeleteTasksAction([])).ok).toBe(false);
    expect(
      (await bulkDeleteTasksAction(Array.from({ length: 201 }, (_, i) => `id${i}`))).ok,
    ).toBe(false);
  });
});
