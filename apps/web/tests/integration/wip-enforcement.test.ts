import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Server-side WIP enforcement. The board blocks over-WIP moves client-side, but
 * the card-detail status picker / MCP / any core caller would bypass it — so the
 * status core now enforces it too. Covers the free-form column path
 * (setTaskColumnAction → explicit column) and the legacy per-status path
 * (setInternalStatus → Project.wipLimits), plus the no-block invariants
 * (same-column move, no limit, CANCELED).
 * Source: lib/board/assertWipNotExceeded.ts, setInternalStatus.ts, board.ts.
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
import { createBoardColumnAction, setTaskColumnAction } from '@/actions/board';
import { setInternalStatusAction } from '@/actions/assignments';
import { makeUser, makeProject, makeTask } from './helpers/factories';

beforeEach(() => {
  mockMe.role = 'ADMIN';
});

async function placeInColumn(taskId: string, columnId: string, statusId: string, status: string) {
  await prisma.task.update({
    where: { id: taskId },
    data: { columnId, internalStatusId: statusId, internalStatus: status as never },
  });
}

describe('WIP enforcement — free-form column (setTaskColumnAction)', () => {
  it('blocks a move into a column that is at its WIP limit, and allows it once there is room', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const p = await makeProject({ ownerId: admin.id });
    const qa = await createBoardColumnAction(p.id, 'Тестирование', 'IN_PROGRESS');
    if (!qa.ok) throw new Error('setup');
    await prisma.boardColumn.update({ where: { id: qa.data!.columnId }, data: { wipLimit: 1 } });
    const occupant = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'IN_PROGRESS' });
    await placeInColumn(occupant.id, qa.data!.columnId, qa.data!.statusId, 'IN_PROGRESS');

    const t = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'TODO' });
    const blocked = await setTaskColumnAction(t.id, qa.data!.columnId);
    expect(blocked.ok).toBe(false); // column full
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).columnId).toBeNull();

    // Raise the limit → now it fits.
    await prisma.boardColumn.update({ where: { id: qa.data!.columnId }, data: { wipLimit: 2 } });
    const ok = await setTaskColumnAction(t.id, qa.data!.columnId);
    expect(ok.ok).toBe(true);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).columnId).toBe(qa.data!.columnId);
  });

  it('does NOT block a re-pin to the same column (not entering)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const p = await makeProject({ ownerId: admin.id });
    const qa = await createBoardColumnAction(p.id, 'Тестирование', 'IN_PROGRESS');
    if (!qa.ok) throw new Error('setup');
    await prisma.boardColumn.update({ where: { id: qa.data!.columnId }, data: { wipLimit: 1 } });
    const t = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'IN_PROGRESS' });
    await placeInColumn(t.id, qa.data!.columnId, qa.data!.statusId, 'IN_PROGRESS');

    // The column is "full" (limit 1, this task is the 1) — moving it to the same
    // column must not be blocked by its own presence.
    const res = await setTaskColumnAction(t.id, qa.data!.columnId);
    expect(res.ok).toBe(true);
  });

  it('does not block when the column has no WIP limit', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const p = await makeProject({ ownerId: admin.id });
    const qa = await createBoardColumnAction(p.id, 'Тестирование', 'IN_PROGRESS');
    if (!qa.ok) throw new Error('setup');
    for (let i = 0; i < 3; i++) {
      const occ = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'IN_PROGRESS' });
      await placeInColumn(occ.id, qa.data!.columnId, qa.data!.statusId, 'IN_PROGRESS');
    }
    const t = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'TODO' });
    expect((await setTaskColumnAction(t.id, qa.data!.columnId)).ok).toBe(true);
  });
});

describe('WIP enforcement — legacy per-status (setInternalStatus via the card picker)', () => {
  it('blocks a status change into a per-status WIP-limited bucket', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const p = await makeProject({ ownerId: admin.id, key: 'WIPL' });
    await prisma.project.update({ where: { id: p.id }, data: { wipLimits: { IN_PROGRESS: 1 } } });
    // One task already IN_PROGRESS fills the per-status limit (no materialized
    // column for a bare makeProject → the by-status path applies).
    await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'IN_PROGRESS' });
    const t = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'TODO' });

    const res = await setInternalStatusAction(t.id, p.key, t.number, 'IN_PROGRESS');
    expect(res.ok).toBe(false);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).internalStatus).toBe('TODO');
  });

  it('does not block a move into CANCELED (terminal, never limited)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const p = await makeProject({ ownerId: admin.id, key: 'WIPC' });
    await prisma.project.update({ where: { id: p.id }, data: { wipLimits: { CANCELED: 1 } } });
    await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'CANCELED' });
    const t = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'TODO' });

    const res = await setInternalStatusAction(t.id, p.key, t.number, 'CANCELED');
    expect(res.ok).toBe(true);
  });
});
