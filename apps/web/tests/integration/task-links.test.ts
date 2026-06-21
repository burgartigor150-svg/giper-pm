import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Task link types (Jira-port #4). Verifies the additive linkType: BLOCKS stays
 * the default + drives blocking; RELATES_TO / DUPLICATES are display-only and
 * never count as blockers; the widened unique key lets a pair carry multiple
 * relations; and the cycle check applies to BLOCKS only.
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
import { addDependencyAction, removeDependencyAction } from '@/actions/dependencies';
import { listTasksForBoard } from '@/lib/tasks';
import { autoUnblockDependents } from '@/lib/tasks/autoTransitions';
import { makeUser, makeProject, makeTask } from './helpers/factories';

function as(u: { id: string; role: 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER' }) {
  mockMe.id = u.id;
  mockMe.role = u.role;
}
beforeEach(() => {
  mockMe.role = 'ADMIN';
});

describe('task links — types', () => {
  it('default link is BLOCKS; a pair can also carry RELATES_TO + DUPLICATES', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'LNKA' });
    const a = await makeTask({ projectId: p.id, creatorId: admin.id });
    const b = await makeTask({ projectId: p.id, creatorId: admin.id });
    as(admin);

    expect((await addDependencyAction(a.id, b.id, p.key, a.number)).ok).toBe(true); // BLOCKS default
    expect((await addDependencyAction(a.id, b.id, p.key, a.number, 'RELATES_TO')).ok).toBe(true);
    expect((await addDependencyAction(a.id, b.id, p.key, a.number, 'DUPLICATES')).ok).toBe(true);

    const rows = await prisma.taskDependency.findMany({ where: { fromTaskId: a.id, toTaskId: b.id } });
    expect(rows.map((r) => r.linkType).sort()).toEqual(['BLOCKS', 'DUPLICATES', 'RELATES_TO']);
    // adding the SAME (from,to,type) again is idempotent (P2002 → ok)
    expect((await addDependencyAction(a.id, b.id, p.key, a.number, 'RELATES_TO')).ok).toBe(true);
    expect(await prisma.taskDependency.count({ where: { fromTaskId: a.id, toTaskId: b.id } })).toBe(3);
  });

  it('rejects an unknown link type and a self-link', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'LNKB' });
    const a = await makeTask({ projectId: p.id, creatorId: admin.id });
    const b = await makeTask({ projectId: p.id, creatorId: admin.id });
    as(admin);
    // @ts-expect-error invalid linkType
    expect((await addDependencyAction(a.id, b.id, p.key, a.number, 'NOPE')).ok).toBe(false);
    expect((await addDependencyAction(a.id, a.id, p.key, a.number, 'RELATES_TO')).ok).toBe(false);
  });

  it('cycle check is BLOCKS-only: B→A BLOCKS rejected after A→B BLOCKS, but B→A RELATES_TO allowed', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'LNKC' });
    const a = await makeTask({ projectId: p.id, creatorId: admin.id });
    const b = await makeTask({ projectId: p.id, creatorId: admin.id });
    as(admin);
    expect((await addDependencyAction(a.id, b.id, p.key, a.number, 'BLOCKS')).ok).toBe(true);
    // reverse BLOCKS would close a cycle → rejected
    const cycle = await addDependencyAction(b.id, a.id, p.key, b.number, 'BLOCKS');
    expect(cycle.ok).toBe(false);
    // reverse RELATES_TO is non-blocking → allowed
    expect((await addDependencyAction(b.id, a.id, p.key, b.number, 'RELATES_TO')).ok).toBe(true);
  });
});

describe('task links — retrofit: only BLOCKS gates work', () => {
  it('openBlockerCount counts BLOCKS only, not RELATES_TO / DUPLICATES', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'LNKD' });
    const target = await makeTask({ projectId: p.id, creatorId: admin.id, status: 'TODO' });
    const blocker = await makeTask({ projectId: p.id, creatorId: admin.id, status: 'TODO' }); // open
    const related = await makeTask({ projectId: p.id, creatorId: admin.id, status: 'TODO' });
    as(admin);

    // a RELATES_TO + DUPLICATES into target must NOT register as a blocker
    await addDependencyAction(related.id, target.id, p.key, related.number, 'RELATES_TO');
    await addDependencyAction(blocker.id, target.id, p.key, blocker.number, 'DUPLICATES');
    let board = await listTasksForBoard(p.key, {}, { id: admin.id, role: 'ADMIN' });
    let t = board.tasks.find((x) => x.id === target.id)!;
    expect(t.openBlockerCount).toBe(0);

    // now a real BLOCKS from an open task → counts 1
    await addDependencyAction(blocker.id, target.id, p.key, blocker.number, 'BLOCKS');
    board = await listTasksForBoard(p.key, {}, { id: admin.id, role: 'ADMIN' });
    t = board.tasks.find((x) => x.id === target.id)!;
    expect(t.openBlockerCount).toBe(1);
  });

  it('autoUnblock only fires off BLOCKS edges', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'LNKE' });
    const blocker = await makeTask({ projectId: p.id, creatorId: admin.id, status: 'IN_PROGRESS' });
    const blocked = await makeTask({ projectId: p.id, creatorId: admin.id, status: 'TODO' });
    await prisma.task.update({ where: { id: blocked.id }, data: { internalStatus: 'BLOCKED' } });
    as(admin);
    // relate (not block) blocker→blocked; closing blocker must NOT unblock
    await addDependencyAction(blocker.id, blocked.id, p.key, blocker.number, 'RELATES_TO');
    await autoUnblockDependents(blocker.id, admin.id);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: blocked.id } })).internalStatus).toBe('BLOCKED');

    // now a real BLOCKS edge; closing blocker unblocks
    await addDependencyAction(blocker.id, blocked.id, p.key, blocker.number, 'BLOCKS');
    await autoUnblockDependents(blocker.id, admin.id);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: blocked.id } })).internalStatus).toBe('TODO');

    void removeDependencyAction;
  });
});
