import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration tests for Scrum sprints — per the design spec's test plan:
 * one-active enforcement, assign, Bitrix-mirror safety, close-carries-incomplete,
 * delete→backlog, burndown off internalStatus, per-stake board scope, RBAC.
 *
 * Source: apps/web/actions/sprints.ts, lib/sprints/*, lib/tasks/listTasksForBoard.ts
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
  createSprintAction,
  startSprintAction,
  closeSprintAction,
  deleteSprintAction,
  assignTaskToSprintAction,
} from '@/actions/sprints';
import { getSprints } from '@/lib/sprints/getSprints';
import { getSprintBurndown } from '@/lib/sprints/getSprintBurndown';
import { listTasksForBoard } from '@/lib/tasks/listTasksForBoard';
import { makeUser, makeProject } from './helpers/factories';

beforeEach(() => {
  mockMe.role = 'ADMIN';
});

let taskSeq = 1000;
async function task(opts: {
  projectId: string;
  creatorId: string;
  internalStatus?: 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELED';
  sprintId?: string | null;
  storyPoints?: number | null;
  externalSource?: string | null;
}) {
  const st = opts.internalStatus ?? 'TODO';
  return prisma.task.create({
    data: {
      projectId: opts.projectId,
      number: ++taskSeq,
      title: 'T' + taskSeq,
      creatorId: opts.creatorId,
      status: st,
      internalStatus: st,
      sprintId: opts.sprintId ?? null,
      storyPoints: opts.storyPoints ?? null,
      externalSource: opts.externalSource ?? null,
    },
    select: { id: true, status: true },
  });
}

describe('sprints — lifecycle', () => {
  it('creates a PLANNED sprint and lists it', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id });
    const res = await createSprintAction(project.key, { name: 'Спринт 1', goal: 'MVP' });
    expect(res.ok).toBe(true);
    const list = await getSprints(project.id);
    expect(list).toHaveLength(1);
    expect(list[0]?.status).toBe('PLANNED');
  });

  it('enforces one ACTIVE per project (starting B auto-closes A)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id });
    const a = await createSprintAction(project.key, { name: 'AA' });
    const b = await createSprintAction(project.key, { name: 'BB' });
    const aId = a.ok ? a.data!.id : '';
    const bId = b.ok ? b.data!.id : '';

    await startSprintAction(aId);
    await startSprintAction(bId);

    const active = await prisma.sprint.findMany({ where: { projectId: project.id, status: 'ACTIVE' } });
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe(bId);
    const closedA = await prisma.sprint.findUniqueOrThrow({ where: { id: aId } });
    expect(closedA.status).toBe('CLOSED');
  });

  it('close carries incomplete cards to the next planned sprint; keeps done', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id });
    const cur = await createSprintAction(project.key, { name: 'Current' });
    const nxt = await createSprintAction(project.key, { name: 'Next' });
    const curId = cur.ok ? cur.data!.id : '';
    const nxtId = nxt.ok ? nxt.data!.id : '';
    await startSprintAction(curId);

    const open = await task({ projectId: project.id, creatorId: admin.id, internalStatus: 'IN_PROGRESS', sprintId: curId });
    const done = await task({ projectId: project.id, creatorId: admin.id, internalStatus: 'DONE', sprintId: curId });

    const res = await closeSprintAction(curId);
    expect(res.ok && res.data?.carried).toBe(1);

    const openAfter = await prisma.task.findUniqueOrThrow({ where: { id: open.id } });
    const doneAfter = await prisma.task.findUniqueOrThrow({ where: { id: done.id } });
    expect(openAfter.sprintId).toBe(nxtId); // carried to next planned
    expect(doneAfter.sprintId).toBe(curId); // done keeps its sprint
    const closed = await prisma.sprint.findUniqueOrThrow({ where: { id: curId } });
    expect(closed.status).toBe('CLOSED');
    expect(closed.closedAt).not.toBeNull();
  });

  it('delete returns cards to the backlog (SetNull), not deletes them', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id });
    const s = await createSprintAction(project.key, { name: 'Doomed' });
    const sId = s.ok ? s.data!.id : '';
    const t = await task({ projectId: project.id, creatorId: admin.id, sprintId: sId });

    await deleteSprintAction(sId);

    const after = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.sprintId).toBeNull();
  });
});

describe('sprints — assignment & scope', () => {
  it('assigns a task to a sprint; it shows on the sprint-filtered board', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id });
    const s = await createSprintAction(project.key, { name: 'SS' });
    const sId = s.ok ? s.data!.id : '';
    const t = await task({ projectId: project.id, creatorId: admin.id });

    const res = await assignTaskToSprintAction(t.id, sId);
    expect(res.ok).toBe(true);

    const board = await listTasksForBoard(project.key, { sprintId: sId }, { id: admin.id, role: 'ADMIN' });
    expect(board.tasks.some((bt) => bt.id === t.id)).toBe(true);
  });

  it('keeps Bitrix-mirror tasks safe (sets sprintId, leaves status)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id });
    const s = await createSprintAction(project.key, { name: 'SS' });
    const sId = s.ok ? s.data!.id : '';
    const mirror = await task({ projectId: project.id, creatorId: admin.id, externalSource: 'bitrix24' });

    const res = await assignTaskToSprintAction(mirror.id, sId);
    expect(res.ok).toBe(true);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: mirror.id } });
    expect(after.sprintId).toBe(sId);
    expect(after.externalSource).toBe('bitrix24'); // untouched
    expect(after.status).toBe(mirror.status); // status track untouched
  });

  it('does not leak a non-stake task on the sprint board (per-stake OR preserved)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id });
    const stranger = await makeUser();
    const s = await createSprintAction(project.key, { name: 'SS' });
    const sId = s.ok ? s.data!.id : '';
    const foreign = await task({ projectId: project.id, creatorId: stranger.id, sprintId: sId });

    // Viewer is a MEMBER who HAS project access (own task = stake) but no
    // stake on the foreign card — it must not leak onto their sprint board.
    const viewer = await makeUser({ role: 'MEMBER' });
    await task({ projectId: project.id, creatorId: viewer.id, sprintId: sId });
    const board = await listTasksForBoard(project.key, { sprintId: sId }, { id: viewer.id, role: 'MEMBER' });
    expect(board.tasks.some((bt) => bt.id === foreign.id)).toBe(false);
  });
});

describe('sprints — burndown & rbac', () => {
  it('counts internalStatus DONE as burned even with null completedAt', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id });
    const s = await createSprintAction(project.key, { name: 'SS' });
    const sId = s.ok ? s.data!.id : '';
    await task({ projectId: project.id, creatorId: admin.id, internalStatus: 'DONE', sprintId: sId });
    await task({ projectId: project.id, creatorId: admin.id, internalStatus: 'TODO', sprintId: sId });

    const bd = await getSprintBurndown(sId);
    expect(bd?.usePoints).toBe(false);
    expect(bd?.committed).toBe(2);
    expect(bd?.remaining).toBe(1); // the DONE one is burned despite null completedAt
    expect(bd?.doneCount).toBe(1);
  });

  it('forbids a MEMBER from creating a sprint', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    mockMe.id = (await makeUser({ role: 'MEMBER' })).id;
    mockMe.role = 'MEMBER';
    const res = await createSprintAction(project.key, { name: 'Nope' });
    expect(res.ok).toBe(false);
  });
});
