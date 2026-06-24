import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration tests for the S6 free-form board-column actions: create (auto-
 * seeds a backing Status), rename, delete (last-of-category guard + archive),
 * drag-reorder, and move-card-into-column (with the workflow-gated category
 * change). Source: apps/web/actions/board.ts.
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
  createBoardColumnAction,
  renameBoardColumnAction,
  deleteBoardColumnAction,
  reorderBoardColumnsAction,
  setTaskColumnAction,
  updateBoardColumnsAction,
} from '@/actions/board';
import { makeUser, makeProject, makeTask } from './helpers/factories';

beforeEach(() => {
  mockMe.role = 'ADMIN';
});

async function columnsOf(projectId: string) {
  return prisma.boardColumn.findMany({ where: { projectId }, orderBy: { order: 'asc' } });
}

describe('board columns — free-form CRUD (S6)', () => {
  it('creates a column with a backing status of the chosen category', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id });

    const res = await createBoardColumnAction(project.id, 'Код-ревью', 'REVIEW');
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const col = await prisma.boardColumn.findUniqueOrThrow({ where: { id: res.data!.columnId } });
    expect(col.name).toBe('Код-ревью');
    expect(col.status).toBe('REVIEW');
    expect(col.statusId).toBe(res.data!.statusId);

    const status = await prisma.status.findUniqueOrThrow({ where: { id: res.data!.statusId } });
    expect(status.category).toBe('REVIEW');
    expect(status.isDefault).toBe(false);
    expect(status.name).toBe('Код-ревью');
  });

  it('lets two columns share a category (unique dropped) with unique status names', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id });

    // "Делаем" avoids colliding with the seeded default IN_PROGRESS status
    // ("В работе") so the suffix sequence is deterministic from the first column.
    const a = await createBoardColumnAction(project.id, 'Делаем', 'IN_PROGRESS');
    const b = await createBoardColumnAction(project.id, 'Делаем', 'IN_PROGRESS');
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    const cols = await columnsOf(project.id);
    expect(cols).toHaveLength(2);
    expect(cols.map((c) => c.status)).toEqual(['IN_PROGRESS', 'IN_PROGRESS']);
    expect(cols.map((c) => c.order)).toEqual([0, 1]);

    // Backing statuses dedupe their name (Status @@unique[projectId,name]).
    const sa = await prisma.status.findUniqueOrThrow({ where: { id: a.data!.statusId } });
    const sb = await prisma.status.findUniqueOrThrow({ where: { id: b.data!.statusId } });
    expect(sa.name).toBe('Делаем');
    expect(sb.name).toBe('Делаем 2');
  });

  it('rejects an empty name and an invalid category', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id });

    expect((await createBoardColumnAction(project.id, '   ', 'TODO')).ok).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((await createBoardColumnAction(project.id, 'X', 'NOPE' as any)).ok).toBe(false);
    expect(await columnsOf(project.id)).toHaveLength(0);
  });

  it('renames a column and its backing status', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id });
    const created = await createBoardColumnAction(project.id, 'Старое', 'TODO');
    if (!created.ok) throw new Error('setup');

    expect((await renameBoardColumnAction(created.data!.columnId, 'Новое')).ok).toBe(true);
    expect((await prisma.boardColumn.findUniqueOrThrow({ where: { id: created.data!.columnId } })).name).toBe('Новое');
    expect((await prisma.status.findUniqueOrThrow({ where: { id: created.data!.statusId } })).name).toBe('Новое');
  });

  it('drag-reorder persists order and ignores foreign ids', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id });
    const ids: string[] = [];
    for (const [n, c] of [['A', 'TODO'], ['B', 'IN_PROGRESS'], ['C', 'REVIEW']] as const) {
      const r = await createBoardColumnAction(project.id, n, c);
      ids.push(r.ok ? r.data!.columnId : '');
    }
    const reordered = [ids[2], ids[0], ids[1], 'foreign'] as string[];
    expect((await reorderBoardColumnsAction(project.id, reordered)).ok).toBe(true);
    expect((await columnsOf(project.id)).map((c) => c.id)).toEqual([ids[2], ids[0], ids[1]]);
  });

  it('refuses to delete the last column of a category, allows a sibling, and clears card columnId', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id });

    const only = await createBoardColumnAction(project.id, 'Готово', 'DONE');
    if (!only.ok) throw new Error('setup');
    // Last (only) DONE column → refused.
    const refused = await deleteBoardColumnAction(only.data!.columnId);
    expect(refused.ok).toBe(false);

    // Two IN_PROGRESS columns → one is deletable.
    const a = await createBoardColumnAction(project.id, 'Делаем', 'IN_PROGRESS');
    const b = await createBoardColumnAction(project.id, 'Тестируем', 'IN_PROGRESS');
    if (!a.ok || !b.ok) throw new Error('setup');

    // Park a card in column A, then delete A.
    const task = await makeTask({ projectId: project.id, creatorId: admin.id, internalStatus: 'IN_PROGRESS' });
    await prisma.task.update({ where: { id: task.id }, data: { columnId: a.data!.columnId } });

    expect((await deleteBoardColumnAction(a.data!.columnId)).ok).toBe(true);
    expect(await prisma.boardColumn.findUnique({ where: { id: a.data!.columnId } })).toBeNull();
    // Card's columnId nulled (SetNull) — board falls back to the sibling.
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).columnId).toBeNull();
    // Backing status archived, not deleted.
    const archived = await prisma.status.findUniqueOrThrow({ where: { id: a.data!.statusId } });
    expect(archived.archivedAt).not.toBeNull();
  });
});

describe('setTaskColumnAction — move card into a free-form column', () => {
  it('same-category move pins columnId + status without changing internalStatus', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id });
    const col = await createBoardColumnAction(project.id, 'К выполнению', 'TODO');
    if (!col.ok) throw new Error('setup');
    const task = await makeTask({ projectId: project.id, creatorId: admin.id, internalStatus: 'TODO' });

    expect((await setTaskColumnAction(task.id, col.data!.columnId)).ok).toBe(true);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.columnId).toBe(col.data!.columnId);
    expect(after.internalStatus).toBe('TODO');
    expect(after.internalStatusId).toBe(col.data!.statusId);
  });

  it('cross-category move runs the status core (internalStatus follows the column category)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id });
    const col = await createBoardColumnAction(project.id, 'В работе', 'IN_PROGRESS');
    if (!col.ok) throw new Error('setup');
    const task = await makeTask({ projectId: project.id, creatorId: admin.id, internalStatus: 'TODO' });

    expect((await setTaskColumnAction(task.id, col.data!.columnId)).ok).toBe(true);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.columnId).toBe(col.data!.columnId);
    expect(after.internalStatus).toBe('IN_PROGRESS');
    expect(after.internalStatusId).toBe(col.data!.statusId);
  });

  it('forbids a MEMBER who cannot edit the project', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    const project = await makeProject({ ownerId: owner.id });
    const stranger = await makeUser({ role: 'MEMBER' });
    mockMe.id = stranger.id;
    mockMe.role = 'MEMBER';

    const res = await createBoardColumnAction(project.id, 'Нельзя', 'TODO');
    expect(res.ok).toBe(false);
    expect(await columnsOf(project.id)).toHaveLength(0);
  });

  it('forbids a non-stakeholder MEMBER from moving a card (same-category IDOR gate)', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    mockMe.id = owner.id;
    const project = await makeProject({ ownerId: owner.id });
    const col = await createBoardColumnAction(project.id, 'К выполнению', 'TODO');
    if (!col.ok) throw new Error('setup');
    const task = await makeTask({ projectId: project.id, creatorId: owner.id, internalStatus: 'TODO' });

    // An authenticated MEMBER who is not creator/assignee/owner/LEAD must not be
    // able to move the card — the same-category branch skips the status core.
    const stranger = await makeUser({ role: 'MEMBER' });
    mockMe.id = stranger.id;
    mockMe.role = 'MEMBER';
    const res = await setTaskColumnAction(task.id, col.data!.columnId);
    expect(res.ok).toBe(false);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).columnId).toBeNull();
  });
});

describe('updateBoardColumnsAction — legacy 1:1 editor still works after unique drop', () => {
  it('creates then updates the same per-status column without duplicating', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id });

    const create = await updateBoardColumnsAction(project.id, [
      { status: 'TODO', name: 'К выполнению', wipLimit: 5, order: 0 },
      { status: 'IN_PROGRESS', name: 'В работе', wipLimit: null, order: 1 },
    ]);
    expect(create.ok).toBe(true);
    let cols = await columnsOf(project.id);
    expect(cols.map((c) => c.status)).toEqual(['TODO', 'IN_PROGRESS']);
    expect(cols.find((c) => c.status === 'TODO')!.wipLimit).toBe(5);

    // Re-save updates in place (no compound unique → matched by first-of-status).
    const update = await updateBoardColumnsAction(project.id, [
      { status: 'TODO', name: 'Очередь', wipLimit: 9, order: 0 },
      { status: 'IN_PROGRESS', name: 'В работе', wipLimit: null, order: 1 },
    ]);
    expect(update.ok).toBe(true);
    cols = await columnsOf(project.id);
    // Still exactly one column per status — no duplicate row created.
    expect(cols.filter((c) => c.status === 'TODO')).toHaveLength(1);
    expect(cols.find((c) => c.status === 'TODO')!.name).toBe('Очередь');
    expect(cols.find((c) => c.status === 'TODO')!.wipLimit).toBe(9);
  });
});
