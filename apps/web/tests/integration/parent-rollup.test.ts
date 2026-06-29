import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Parent auto-move on child status (Kaiten parity, opt-in). Verifies the
 * forward-only rollup rules: → IN_PROGRESS when a subtask starts, → DONE when
 * all non-canceled subtasks are done (synthetic итог, no comment, no Bitrix
 * push), all-canceled not closed, one-open no-move, forward-only, already-DONE
 * no-op, recursion up the tree, and the flag-off byte-identical default.
 * Source: lib/tasks/rollupParentOnChild.ts + the setInternalStatus hook.
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
import { rollupParentFromChild, AUTO_PARENT_DONE_RESULT } from '@/lib/tasks/rollupParentOnChild';
import { setInternalStatusAction } from '@/actions/assignments';
import { makeUser, makeProject, makeTask } from './helpers/factories';

beforeEach(() => {
  mockMe.role = 'ADMIN';
});

async function project(flag: boolean) {
  const admin = await makeUser({ role: 'ADMIN' });
  mockMe.id = admin.id;
  const p = await makeProject({ ownerId: admin.id });
  if (flag) await prisma.project.update({ where: { id: p.id }, data: { autoMoveParentOnChild: true } });
  return { admin, p };
}
async function makeParent(p: { id: string }, admin: { id: string }, status: string) {
  return makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: status as never });
}
async function makeChild(p: { id: string }, admin: { id: string }, parentId: string, status: string) {
  const t = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: status as never });
  await prisma.task.update({ where: { id: t.id }, data: { parentId } });
  return t;
}
const statusOf = async (id: string) =>
  (await prisma.task.findUniqueOrThrow({ where: { id } })).internalStatus;

describe('rollupParentFromChild', () => {
  it('does nothing when the project flag is OFF (default)', async () => {
    const { admin, p } = await project(false);
    const parent = await makeParent(p, admin, 'TODO');
    const c = await makeChild(p, admin, parent.id, 'IN_PROGRESS');
    await rollupParentFromChild(c.id, admin.id);
    expect(await statusOf(parent.id)).toBe('TODO');
  });

  it('moves a queue parent to IN_PROGRESS when a subtask starts', async () => {
    const { admin, p } = await project(true);
    const parent = await makeParent(p, admin, 'TODO');
    const c = await makeChild(p, admin, parent.id, 'IN_PROGRESS');
    await rollupParentFromChild(c.id, admin.id);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: parent.id } });
    expect(after.internalStatus).toBe('IN_PROGRESS');
    expect(after.startedAt).not.toBeNull();
  });

  it('closes the parent (synthetic итог) when all subtasks are DONE — no comment, no mirror push', async () => {
    const { admin, p } = await project(true);
    const parent = await makeParent(p, admin, 'IN_PROGRESS');
    await prisma.task.update({
      where: { id: parent.id },
      data: { externalSource: 'bitrix24', externalId: 'BX-P', status: 'TODO' }, // mirror parent
    });
    const a = await makeChild(p, admin, parent.id, 'DONE');
    await makeChild(p, admin, parent.id, 'DONE');
    await rollupParentFromChild(a.id, admin.id);

    const after = await prisma.task.findUniqueOrThrow({ where: { id: parent.id } });
    expect(after.internalStatus).toBe('DONE');
    expect(after.completedAt).not.toBeNull();
    expect(after.completionResult).toBe(AUTO_PARENT_DONE_RESULT);
    expect(after.status).toBe('TODO'); // Bitrix-mirror status NEVER touched
    expect(await prisma.comment.count({ where: { taskId: parent.id } })).toBe(0); // no итог comment
  });

  it('excludes CANCELED subtasks from the all-done check', async () => {
    const { admin, p } = await project(true);
    const parent = await makeParent(p, admin, 'IN_PROGRESS');
    const a = await makeChild(p, admin, parent.id, 'DONE');
    await makeChild(p, admin, parent.id, 'CANCELED');
    await rollupParentFromChild(a.id, admin.id);
    expect(await statusOf(parent.id)).toBe('DONE');
  });

  it('does NOT close a parent whose subtasks are all CANCELED (abandoned)', async () => {
    const { admin, p } = await project(true);
    const parent = await makeParent(p, admin, 'IN_PROGRESS');
    const a = await makeChild(p, admin, parent.id, 'CANCELED');
    await makeChild(p, admin, parent.id, 'CANCELED');
    await rollupParentFromChild(a.id, admin.id);
    expect(await statusOf(parent.id)).toBe('IN_PROGRESS'); // unchanged
  });

  it('does NOT close while a sibling is still open', async () => {
    const { admin, p } = await project(true);
    const parent = await makeParent(p, admin, 'IN_PROGRESS');
    const a = await makeChild(p, admin, parent.id, 'DONE');
    await makeChild(p, admin, parent.id, 'TODO');
    await rollupParentFromChild(a.id, admin.id);
    expect(await statusOf(parent.id)).toBe('IN_PROGRESS');
  });

  it('is forward-only: a started subtask does not pull a REVIEW parent back to IN_PROGRESS', async () => {
    const { admin, p } = await project(true);
    const parent = await makeParent(p, admin, 'REVIEW');
    const c = await makeChild(p, admin, parent.id, 'IN_PROGRESS');
    await rollupParentFromChild(c.id, admin.id);
    expect(await statusOf(parent.id)).toBe('REVIEW');
  });

  it('does NOT auto-close a CANCELED parent (terminal, human-set) when subtasks finish', async () => {
    const { admin, p } = await project(true);
    const parent = await makeParent(p, admin, 'CANCELED');
    const a = await makeChild(p, admin, parent.id, 'DONE');
    await makeChild(p, admin, parent.id, 'DONE');
    await rollupParentFromChild(a.id, admin.id);
    expect(await statusOf(parent.id)).toBe('CANCELED'); // never advanced
  });

  it('does NOT auto-close a REVIEW parent (reviewer gate) when all subtasks finish', async () => {
    const { admin, p } = await project(true);
    const parent = await makeParent(p, admin, 'REVIEW');
    const a = await makeChild(p, admin, parent.id, 'DONE');
    await makeChild(p, admin, parent.id, 'DONE');
    await rollupParentFromChild(a.id, admin.id);
    expect(await statusOf(parent.id)).toBe('REVIEW'); // left for the reviewer
  });

  it('stamps startedAt when a queue parent jumps straight to DONE', async () => {
    const { admin, p } = await project(true);
    const parent = await makeParent(p, admin, 'TODO');
    const a = await makeChild(p, admin, parent.id, 'DONE');
    await rollupParentFromChild(a.id, admin.id);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: parent.id } });
    expect(after.internalStatus).toBe('DONE');
    expect(after.startedAt).not.toBeNull();
    expect(after.completedAt).not.toBeNull();
  });

  it('stops the climb at a cross-project parent', async () => {
    const { admin, p } = await project(true);
    const other = await makeProject({ ownerId: admin.id });
    const foreignParent = await makeTask({ projectId: other.id, creatorId: admin.id, internalStatus: 'TODO' });
    const c = await makeTask({ projectId: p.id, creatorId: admin.id, internalStatus: 'IN_PROGRESS' });
    await prisma.task.update({ where: { id: c.id }, data: { parentId: foreignParent.id } });
    await rollupParentFromChild(c.id, admin.id);
    expect(await statusOf(foreignParent.id)).toBe('TODO'); // unchanged across projects
  });

  it('is a no-op when the parent is already DONE (completedAt preserved)', async () => {
    const { admin, p } = await project(true);
    const parent = await makeParent(p, admin, 'DONE');
    const original = new Date('2020-01-01T00:00:00Z');
    await prisma.task.update({ where: { id: parent.id }, data: { completedAt: original } });
    const a = await makeChild(p, admin, parent.id, 'DONE');
    await rollupParentFromChild(a.id, admin.id);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: parent.id } });
    expect(after.internalStatus).toBe('DONE');
    expect(after.completedAt?.toISOString()).toBe(original.toISOString());
  });

  it('cascades up multiple levels (grandparent rolls up too)', async () => {
    const { admin, p } = await project(true);
    const grand = await makeParent(p, admin, 'TODO');
    const parent = await makeChild(p, admin, grand.id, 'TODO'); // parent is a child of grand
    const c = await makeChild(p, admin, parent.id, 'IN_PROGRESS');
    await rollupParentFromChild(c.id, admin.id);
    expect(await statusOf(parent.id)).toBe('IN_PROGRESS');
    expect(await statusOf(grand.id)).toBe('IN_PROGRESS'); // cascaded
  });

  it('fires through the setInternalStatus hook on a real child status change', async () => {
    const { admin, p } = await project(true);
    const parent = await makeParent(p, admin, 'TODO');
    const c = await makeChild(p, admin, parent.id, 'TODO');
    const res = await setInternalStatusAction(c.id, p.key, c.number, 'IN_PROGRESS');
    expect(res.ok).toBe(true);
    expect(await statusOf(parent.id)).toBe('IN_PROGRESS');
  });
});
