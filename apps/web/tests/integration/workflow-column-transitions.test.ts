import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Per-column transitions (Half B). Verifies the reader's invariant order
 * (inert default, CANCELED escape hatch, null-from fail-open, allowlist match),
 * the same-category enforcement in setTaskColumnAction (denied moves commit
 * nothing; cross-category stays on the category engine), and the
 * setWorkflowColumnTransitionsAction save/clear/project-scope.
 * Source: lib/workflow/isColumnTransitionAllowed.ts, actions/board.ts, actions/workflow.ts.
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
import { isColumnTransitionAllowed } from '@/lib/workflow/isColumnTransitionAllowed';
import { createBoardColumnAction, setTaskColumnAction } from '@/actions/board';
import { setWorkflowColumnTransitionsAction } from '@/actions/workflow';
import { makeUser, makeProject, makeTask } from './helpers/factories';

beforeEach(() => {
  mockMe.role = 'ADMIN';
});

async function rawCol(projectId: string, name: string, status: string, order: number) {
  return prisma.boardColumn.create({
    data: { projectId, name, status: status as never, order },
  });
}
async function wct(projectId: string, fromColumnId: string, toColumnId: string) {
  return prisma.workflowColumnTransition.create({ data: { projectId, fromColumnId, toColumnId } });
}

describe('isColumnTransitionAllowed — invariant order', () => {
  it('inert default: an empty table allows any same-category pair', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id });
    const a = await rawCol(p.id, 'A', 'IN_PROGRESS', 0);
    const b = await rawCol(p.id, 'B', 'IN_PROGRESS', 1);
    expect(await isColumnTransitionAllowed(p.id, a.id, b.id)).toBe(true);
  });

  it('a self-move is always allowed', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id });
    const a = await rawCol(p.id, 'A', 'IN_PROGRESS', 0);
    expect(await isColumnTransitionAllowed(p.id, a.id, a.id)).toBe(true);
  });

  it('moving into a CANCELED-category column is always allowed, even with a restrictive set', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id });
    const a = await rawCol(p.id, 'A', 'IN_PROGRESS', 0);
    const b = await rawCol(p.id, 'B', 'IN_PROGRESS', 1);
    const x = await rawCol(p.id, 'Отмена', 'CANCELED', 2);
    await wct(p.id, a.id, b.id); // table non-empty + (a→x) NOT listed
    expect(await isColumnTransitionAllowed(p.id, a.id, x.id)).toBe(true);
  });

  it('a null/undefined source column is allowed (fail-open, never trap a card)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id });
    const a = await rawCol(p.id, 'A', 'IN_PROGRESS', 0);
    const b = await rawCol(p.id, 'B', 'IN_PROGRESS', 1);
    await wct(p.id, a.id, b.id);
    expect(await isColumnTransitionAllowed(p.id, null, b.id)).toBe(true);
  });

  it('with rows, only listed edges are allowed', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id });
    const a = await rawCol(p.id, 'A', 'IN_PROGRESS', 0);
    const b = await rawCol(p.id, 'B', 'IN_PROGRESS', 1);
    const c = await rawCol(p.id, 'C', 'IN_PROGRESS', 2);
    await wct(p.id, a.id, b.id);
    expect(await isColumnTransitionAllowed(p.id, a.id, b.id)).toBe(true);
    expect(await isColumnTransitionAllowed(p.id, a.id, c.id)).toBe(false);
    expect(await isColumnTransitionAllowed(p.id, b.id, a.id)).toBe(false);
  });
});

describe('setTaskColumnAction — per-column transition enforcement', () => {
  it('inert: a same-category move succeeds when the project has no column rules', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const p = await makeProject({ ownerId: admin.id });
    const dev = await createBoardColumnAction(p.id, 'Разработка', 'IN_PROGRESS');
    const qa = await createBoardColumnAction(p.id, 'Тестирование', 'IN_PROGRESS');
    if (!dev.ok || !qa.ok) throw new Error('setup');
    const task = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'IN_PROGRESS' });
    await prisma.task.update({ where: { id: task.id }, data: { columnId: dev.data!.columnId } });

    expect((await setTaskColumnAction(task.id, qa.data!.columnId)).ok).toBe(true);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).columnId).toBe(qa.data!.columnId);
  });

  it('enforces the allowlist: allowed edge passes, reverse is denied and commits nothing', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const p = await makeProject({ ownerId: admin.id });
    const dev = await createBoardColumnAction(p.id, 'Разработка', 'IN_PROGRESS');
    const qa = await createBoardColumnAction(p.id, 'Тестирование', 'IN_PROGRESS');
    if (!dev.ok || !qa.ok) throw new Error('setup');
    await wct(p.id, dev.data!.columnId, qa.data!.columnId); // dev → qa only

    const task = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'IN_PROGRESS' });
    await prisma.task.update({ where: { id: task.id }, data: { columnId: dev.data!.columnId } });

    // dev → qa: allowed
    expect((await setTaskColumnAction(task.id, qa.data!.columnId)).ok).toBe(true);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).columnId).toBe(qa.data!.columnId);

    // qa → dev: denied, no write
    const res = await setTaskColumnAction(task.id, dev.data!.columnId);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('TRANSITION_NOT_ALLOWED');
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).columnId).toBe(qa.data!.columnId); // unchanged
  });

  it('a card is never trapped: it can always be CANCELED via the category engine despite a restrictive column sink', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const p = await makeProject({ ownerId: admin.id });
    const dev = await createBoardColumnAction(p.id, 'Разработка', 'IN_PROGRESS');
    const qa = await createBoardColumnAction(p.id, 'Тестирование', 'IN_PROGRESS');
    if (!dev.ok || !qa.ok) throw new Error('setup');
    // QA is a column SINK (incoming dev→qa, no outgoing) — no same-category escape.
    await wct(p.id, dev.data!.columnId, qa.data!.columnId);
    const cancelCol = await rawCol(p.id, 'Отмена', 'CANCELED', 9);

    const task = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'IN_PROGRESS' });
    await prisma.task.update({ where: { id: task.id }, data: { columnId: qa.data!.columnId } });

    // qa → cancel: cross-category → category engine always allows →CANCELED, so
    // the column allowlist can never trap the card.
    const res = await setTaskColumnAction(task.id, cancelCol.id);
    expect(res.ok).toBe(true);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).internalStatus).toBe('CANCELED');
  });

  it('column rules do NOT gate cross-category moves (the category engine owns those)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const p = await makeProject({ ownerId: admin.id });
    const dev = await createBoardColumnAction(p.id, 'Разработка', 'IN_PROGRESS');
    const qa = await createBoardColumnAction(p.id, 'Тестирование', 'IN_PROGRESS');
    if (!dev.ok || !qa.ok) throw new Error('setup');
    // A restrictive column rule exists (dev→qa only), but the move is cross-category.
    await wct(p.id, dev.data!.columnId, qa.data!.columnId);
    const task = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'TODO' });

    // TODO → QA(IN_PROGRESS): cross-category → routes through the category engine
    // (no WorkflowTransition rows → allowed); the column allowlist is not consulted.
    const res = await setTaskColumnAction(task.id, qa.data!.columnId);
    expect(res.ok).toBe(true);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.internalStatus).toBe('IN_PROGRESS');
    expect(after.columnId).toBe(qa.data!.columnId);
  });
});

describe('setWorkflowColumnTransitionsAction', () => {
  it('saves edges, drops a foreign column id, and clears on empty', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const p = await makeProject({ ownerId: admin.id });
    const other = await makeProject({ ownerId: admin.id });
    const a = await createBoardColumnAction(p.id, 'A', 'IN_PROGRESS');
    const b = await createBoardColumnAction(p.id, 'B', 'IN_PROGRESS');
    const foreign = await createBoardColumnAction(other.id, 'F', 'IN_PROGRESS');
    if (!a.ok || !b.ok || !foreign.ok) throw new Error('setup');

    const res = await setWorkflowColumnTransitionsAction(p.key, [
      { from: a.data!.columnId, to: b.data!.columnId },
      { from: a.data!.columnId, to: foreign.data!.columnId }, // foreign target → dropped
      { from: a.data!.columnId, to: a.data!.columnId }, // self → dropped
    ]);
    expect(res.ok).toBe(true);
    const rows = await prisma.workflowColumnTransition.findMany({ where: { projectId: p.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fromColumnId).toBe(a.data!.columnId);
    expect(rows[0]?.toColumnId).toBe(b.data!.columnId);

    // Empty payload clears → inert.
    expect((await setWorkflowColumnTransitionsAction(p.key, [])).ok).toBe(true);
    expect(await prisma.workflowColumnTransition.count({ where: { projectId: p.id } })).toBe(0);
  });

  it('forbids a non-editor', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: owner.id });
    const a = await (async () => {
      mockMe.id = owner.id;
      return createBoardColumnAction(p.id, 'A', 'IN_PROGRESS');
    })();
    if (!a.ok) throw new Error('setup');
    const stranger = await makeUser({ role: 'MEMBER' });
    mockMe.id = stranger.id;
    mockMe.role = 'MEMBER';
    const res = await setWorkflowColumnTransitionsAction(p.key, [
      { from: a.data!.columnId, to: a.data!.columnId },
    ]);
    expect(res.ok).toBe(false);
  });
});
