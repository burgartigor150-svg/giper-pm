import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Board bulk-move (bulkMoveTasksOnBoardAction). Unlike the list view's bulk
 * 'status' op (mirror-only), this drives the board's OWN track via
 * setInternalStatus / moveTaskToColumn, so a moved card actually repositions.
 * Verifies: per-task gate (forbidden → counted failed, never aborts), the
 * internalStatus actually changes, the free-form column path pins columnId, and
 * closing targets / batch guards are rejected at the boundary.
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
import { bulkMoveTasksOnBoardAction } from '@/actions/boardBulk';
import { createBoardColumnAction } from '@/actions/board';
import { makeUser, makeProject, addMember, makeTask } from './helpers/factories';

function as(user: { id: string; role: 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER' }) {
  mockMe.id = user.id;
  mockMe.role = user.role;
}

beforeEach(() => {
  mockMe.role = 'ADMIN';
});

describe('bulkMoveTasksOnBoardAction — status target', () => {
  it('moves the INTERNAL status of many cards (the board track), not just the mirror', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'BBMA' });
    const t1 = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'TODO' });
    const t2 = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'TODO' });
    as(admin);

    const res = await bulkMoveTasksOnBoardAction([t1.id, t2.id], { kind: 'status', status: 'IN_PROGRESS' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.succeeded).toBe(2);
      expect(res.data.failed).toBe(0);
    }
    const after = await prisma.task.findMany({
      where: { id: { in: [t1.id, t2.id] } },
      select: { internalStatus: true },
    });
    expect(after.every((t) => t.internalStatus === 'IN_PROGRESS')).toBe(true);
  });

  it('PER-ITEM authz: a stakeholder member moves only their own card; others are skipped', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'BBMB' });
    const member = await makeUser({ role: 'MEMBER' });
    await addMember(p.id, member.id, 'CONTRIBUTOR');
    const mine = await makeTask({
      projectId: p.id,
      creatorId: admin.id,
      assigneeId: member.id,
      internalStatus: 'TODO',
    });
    const notMine = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'TODO' });
    as(member);

    const res = await bulkMoveTasksOnBoardAction([mine.id, notMine.id], { kind: 'status', status: 'IN_PROGRESS' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.succeeded).toBe(1);
      expect(res.data.failed).toBe(1);
    }
    expect((await prisma.task.findUniqueOrThrow({ where: { id: mine.id } })).internalStatus).toBe('IN_PROGRESS');
    expect((await prisma.task.findUniqueOrThrow({ where: { id: notMine.id } })).internalStatus).toBe('TODO');
  });

  it('rejects a CLOSING target (DONE) at the boundary — no per-card итог prompt', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'BBMC' });
    const t = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'TODO' });
    as(admin);

    const done = await bulkMoveTasksOnBoardAction([t.id], { kind: 'status', status: 'DONE' });
    expect(done.ok).toBe(false);
    if (!done.ok) expect(done.error.code).toBe('VALIDATION');

    const canceled = await bulkMoveTasksOnBoardAction([t.id], { kind: 'status', status: 'CANCELED' });
    expect(canceled.ok).toBe(false);
    // Nothing moved.
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).internalStatus).toBe('TODO');
  });

  it('validates empty selection, oversize batch, bad target and a non-array id list', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    await makeProject({ ownerId: admin.id, key: 'BBMD' });
    as(admin);

    const empty = await bulkMoveTasksOnBoardAction([], { kind: 'status', status: 'TODO' });
    expect(empty.ok).toBe(false);

    const huge = await bulkMoveTasksOnBoardAction(
      Array.from({ length: 201 }, (_, i) => `id${i}`),
      { kind: 'status', status: 'TODO' },
    );
    expect(huge.ok).toBe(false);

    // @ts-expect-error — invalid target kind is rejected by the schema
    const bad = await bulkMoveTasksOnBoardAction(['x'], { kind: 'nope' });
    expect(bad.ok).toBe(false);

    const notArray = await bulkMoveTasksOnBoardAction('oops' as never, { kind: 'status', status: 'TODO' });
    expect(notArray.ok).toBe(false);
    if (!notArray.ok) expect(notArray.error.code).toBe('VALIDATION');
  });

  it('de-dupes repeated ids so a card is moved once', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'BBME' });
    const t = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'TODO' });
    as(admin);
    const res = await bulkMoveTasksOnBoardAction([t.id, t.id, t.id], { kind: 'status', status: 'REVIEW' });
    expect(res.ok && res.data.succeeded).toBe(1);
  });
});

describe('bulkMoveTasksOnBoardAction — column target (free-form)', () => {
  it('pins columnId and follows the column category for many cards', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'BBCA' });
    const col = await createBoardColumnAction(p.id, 'В работе', 'IN_PROGRESS');
    if (!col.ok) throw new Error('setup: column');
    const t1 = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'TODO' });
    const t2 = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'TODO' });
    as(admin);

    const res = await bulkMoveTasksOnBoardAction([t1.id, t2.id], { kind: 'column', columnId: col.data!.columnId });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.succeeded).toBe(2);
    const after = await prisma.task.findMany({
      where: { id: { in: [t1.id, t2.id] } },
      select: { columnId: true, internalStatus: true },
    });
    expect(after.every((t) => t.columnId === col.data!.columnId)).toBe(true);
    expect(after.every((t) => t.internalStatus === 'IN_PROGRESS')).toBe(true);
  });

  it('an unknown column id fails every item (counted, never thrown)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'BBCB' });
    const t = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'TODO' });
    as(admin);

    const res = await bulkMoveTasksOnBoardAction([t.id], { kind: 'column', columnId: 'does-not-exist' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.succeeded).toBe(0);
      expect(res.data.failed).toBe(1);
    }
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).columnId).toBeNull();
  });
});
