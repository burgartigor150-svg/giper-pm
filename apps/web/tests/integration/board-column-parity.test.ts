import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Free-form column parity with Kaiten:
 *  (1) setBoardColumnCategoryAction — re-type a column; its cards cascade to the
 *      new category, the backing Status is re-categorized, DONE stamps a
 *      completion time, CANCELED is rejected.
 *  (2) auto-assign — entering an "in progress / done" column with no responsible
 *      makes the mover the responsible (assignee); queue/CANCELED don't, and an
 *      existing assignee is never overwritten.
 * Source: actions/board.ts setBoardColumnCategoryAction, lib/tasks/setInternalStatus.ts.
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
import { createBoardColumnAction, setBoardColumnCategoryAction } from '@/actions/board';
import { setInternalStatusAction } from '@/actions/assignments';
import { makeUser, makeProject, makeTask } from './helpers/factories';

beforeEach(() => {
  mockMe.role = 'ADMIN';
});

async function placeTaskInColumn(taskId: string, columnId: string, statusId: string, status: string) {
  await prisma.task.update({
    where: { id: taskId },
    data: { columnId, internalStatusId: statusId, internalStatus: status as never },
  });
}

describe('setBoardColumnCategoryAction — change column type', () => {
  it('re-types the column, re-categorizes its Status, and cascades cards', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const p = await makeProject({ ownerId: admin.id });
    const col = await createBoardColumnAction(p.id, 'Колонка', 'TODO');
    if (!col.ok) throw new Error('setup');
    const task = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'TODO' });
    await placeTaskInColumn(task.id, col.data!.columnId, col.data!.statusId, 'TODO');

    const res = await setBoardColumnCategoryAction(col.data!.columnId, 'IN_PROGRESS');
    expect(res.ok).toBe(true);

    const after = await prisma.boardColumn.findUniqueOrThrow({ where: { id: col.data!.columnId } });
    expect(after.status).toBe('IN_PROGRESS');
    const status = await prisma.status.findUniqueOrThrow({ where: { id: col.data!.statusId } });
    expect(status.category).toBe('IN_PROGRESS');
    const t = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(t.internalStatus).toBe('IN_PROGRESS');
    expect(t.internalStatusId).toBe(col.data!.statusId);
  });

  it('re-typing to DONE stamps completedAt on cards that lack one', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const p = await makeProject({ ownerId: admin.id });
    const col = await createBoardColumnAction(p.id, 'В работе', 'IN_PROGRESS');
    if (!col.ok) throw new Error('setup');
    const task = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'IN_PROGRESS' });
    await placeTaskInColumn(task.id, col.data!.columnId, col.data!.statusId, 'IN_PROGRESS');
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).completedAt).toBeNull();

    expect((await setBoardColumnCategoryAction(col.data!.columnId, 'DONE')).ok).toBe(true);
    const t = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(t.internalStatus).toBe('DONE');
    expect(t.completedAt).not.toBeNull();
  });

  it('rejects re-typing to CANCELED (a CANCELED column is hidden)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const p = await makeProject({ ownerId: admin.id });
    const col = await createBoardColumnAction(p.id, 'Колонка', 'TODO');
    if (!col.ok) throw new Error('setup');
    const res = await setBoardColumnCategoryAction(col.data!.columnId, 'CANCELED');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
    expect((await prisma.boardColumn.findUniqueOrThrow({ where: { id: col.data!.columnId } })).status).toBe('TODO');
  });

  it('is a no-op when the category is unchanged', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const p = await makeProject({ ownerId: admin.id });
    const col = await createBoardColumnAction(p.id, 'Колонка', 'TODO');
    if (!col.ok) throw new Error('setup');
    expect((await setBoardColumnCategoryAction(col.data!.columnId, 'TODO')).ok).toBe(true);
  });

  it('does not touch cards in OTHER columns', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const p = await makeProject({ ownerId: admin.id });
    const colA = await createBoardColumnAction(p.id, 'A', 'TODO');
    const colB = await createBoardColumnAction(p.id, 'B', 'TODO');
    if (!colA.ok || !colB.ok) throw new Error('setup');
    const tA = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'TODO' });
    const tB = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'TODO' });
    await placeTaskInColumn(tA.id, colA.data!.columnId, colA.data!.statusId, 'TODO');
    await placeTaskInColumn(tB.id, colB.data!.columnId, colB.data!.statusId, 'TODO');

    await setBoardColumnCategoryAction(colA.data!.columnId, 'IN_PROGRESS');
    expect((await prisma.task.findUniqueOrThrow({ where: { id: tA.id } })).internalStatus).toBe('IN_PROGRESS');
    expect((await prisma.task.findUniqueOrThrow({ where: { id: tB.id } })).internalStatus).toBe('TODO'); // untouched
  });

  it('forbids a non-editor', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    mockMe.id = owner.id;
    const p = await makeProject({ ownerId: owner.id });
    const col = await createBoardColumnAction(p.id, 'Колонка', 'TODO');
    if (!col.ok) throw new Error('setup');
    const stranger = await makeUser({ role: 'MEMBER' });
    mockMe.id = stranger.id;
    mockMe.role = 'MEMBER';
    const res = await setBoardColumnCategoryAction(col.data!.columnId, 'IN_PROGRESS');
    expect(res.ok).toBe(false);
  });

  it('re-typing the LAST column of a category sweeps stranded (null-columnId) cards of that category', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const p = await makeProject({ ownerId: admin.id });
    const col = await createBoardColumnAction(p.id, 'К работе', 'TODO');
    if (!col.ok) throw new Error('setup');
    // An orphan: TODO status but NO column (e.g. a prior column delete SetNull'd it).
    const orphan = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'TODO' });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: orphan.id } })).columnId).toBeNull();

    expect((await setBoardColumnCategoryAction(col.data!.columnId, 'IN_PROGRESS')).ok).toBe(true);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: orphan.id } });
    expect(after.internalStatus).toBe('IN_PROGRESS'); // swept, not stranded
    expect(after.columnId).toBe(col.data!.columnId); // given a home
  });

  it('does NOT sweep orphans when a sibling column of the old category remains', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const p = await makeProject({ ownerId: admin.id });
    const a = await createBoardColumnAction(p.id, 'A', 'TODO');
    const b = await createBoardColumnAction(p.id, 'B', 'TODO');
    if (!a.ok || !b.ok) throw new Error('setup');
    const orphan = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'TODO' });

    // Re-type A; B is still a TODO column → orphans must stay TODO.
    expect((await setBoardColumnCategoryAction(a.data!.columnId, 'IN_PROGRESS')).ok).toBe(true);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: orphan.id } });
    expect(after.internalStatus).toBe('TODO');
    expect(after.columnId).toBeNull();
  });

  it('re-typing to DONE stamps completedAt on native cards but leaves Bitrix-mirror cards to upstream', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const p = await makeProject({ ownerId: admin.id });
    const col = await createBoardColumnAction(p.id, 'В работе', 'IN_PROGRESS');
    if (!col.ok) throw new Error('setup');
    const native = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'IN_PROGRESS' });
    const mirror = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'IN_PROGRESS' });
    await placeTaskInColumn(native.id, col.data!.columnId, col.data!.statusId, 'IN_PROGRESS');
    await placeTaskInColumn(mirror.id, col.data!.columnId, col.data!.statusId, 'IN_PROGRESS');
    await prisma.task.update({
      where: { id: mirror.id },
      data: { externalSource: 'bitrix24', externalId: 'BX-1' },
    });

    expect((await setBoardColumnCategoryAction(col.data!.columnId, 'DONE')).ok).toBe(true);
    const n = await prisma.task.findUniqueOrThrow({ where: { id: native.id } });
    const m = await prisma.task.findUniqueOrThrow({ where: { id: mirror.id } });
    expect(n.internalStatus).toBe('DONE');
    expect(n.completedAt).not.toBeNull(); // native stamped
    expect(m.internalStatus).toBe('DONE'); // mirror's internal track follows
    expect(m.completedAt).toBeNull(); // but completion stays Bitrix-owned
  });
});

describe('auto-assign responsible on entering an active/done column', () => {
  it('an unassigned card entering IN_PROGRESS gets the mover as assignee', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const p = await makeProject({ ownerId: admin.id, key: 'AAS' });
    const task = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'BACKLOG', assigneeId: null });

    const res = await setInternalStatusAction(task.id, p.key, task.number, 'IN_PROGRESS');
    expect(res.ok).toBe(true);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).assigneeId).toBe(admin.id);
  });

  it('does not overwrite an existing assignee', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const other = await makeUser({ role: 'MEMBER' });
    mockMe.id = admin.id;
    const p = await makeProject({ ownerId: admin.id, key: 'AASB' });
    const task = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'BACKLOG', assigneeId: other.id });

    await setInternalStatusAction(task.id, p.key, task.number, 'IN_PROGRESS');
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).assigneeId).toBe(other.id);
  });

  it('does NOT auto-assign on a move into a queue category (TODO)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const p = await makeProject({ ownerId: admin.id, key: 'AASC' });
    const task = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'BACKLOG', assigneeId: null });

    await setInternalStatusAction(task.id, p.key, task.number, 'TODO');
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).assigneeId).toBeNull();
  });

  it('does NOT auto-assign on a move into CANCELED', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const p = await makeProject({ ownerId: admin.id, key: 'AASD' });
    const task = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'BACKLOG', assigneeId: null });

    await setInternalStatusAction(task.id, p.key, task.number, 'CANCELED');
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).assigneeId).toBeNull();
  });

  it('auto-assigns when closing (DONE) an unassigned card', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const p = await makeProject({ ownerId: admin.id, key: 'AASE' });
    const task = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'IN_PROGRESS', assigneeId: null });

    const res = await setInternalStatusAction(task.id, p.key, task.number, 'DONE', 'готово');
    expect(res.ok).toBe(true);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).assigneeId).toBe(admin.id);
  });
});
