import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tester accept/return (QA acceptance loop) — the TESTING mirror of the
 * reviewer/REVIEW flow. Actions live in:
 *   apps/web/actions/testing.ts (acceptTestingAction / returnFromTestingAction)
 *   apps/web/actions/tasks.ts   (setTesterAction)
 * plus the stronger-than-reviewer leave-gate in:
 *   apps/web/lib/tasks/setInternalStatus.ts
 *
 * Permission shape: ONLY the named tester (or a holder of task.testing.close —
 * ADMIN/PM by baseline) can accept or return. State guard: task must be in
 * internalStatus TESTING. acceptTesting moves TESTING→REVIEW (NOT DONE);
 * returnFromTesting moves TESTING→IN_PROGRESS. Side effects (internal comment,
 * notification) are verified via the database — no mocks for them.
 */

const mockMe = {
  id: '',
  role: 'MEMBER' as 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER',
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

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from '@giper/db';
import { acceptTestingAction, returnFromTestingAction } from '@/actions/testing';
import { setTesterAction } from '@/actions/tasks';
import { setInternalStatus } from '@/lib/tasks/setInternalStatus';
import { approveTaskAction, rejectTaskAction } from '@/actions/review';
import { makeProject, makeTask, makeUser } from './helpers/factories';

beforeEach(() => {
  mockMe.id = '';
  mockMe.role = 'MEMBER';
});

async function setupTestingTask(testerId: string | null = null) {
  const owner = await makeUser();
  const assignee = await makeUser();
  const project = await makeProject({ ownerId: owner.id, key: 'QA' });
  const t = await makeTask({
    projectId: project.id,
    creatorId: owner.id,
    assigneeId: assignee.id,
    number: 1,
    title: 'Needs QA',
  });
  await prisma.task.update({
    where: { id: t.id },
    data: { internalStatus: 'TESTING', testerId },
  });
  return { owner, assignee, project, taskId: t.id, number: t.number };
}

describe('acceptTestingAction', () => {
  it('tester can accept → internalStatus=REVIEW (NOT DONE) + no completedAt + internal comment', async () => {
    const tester = await makeUser();
    const { project, taskId, number } = await setupTestingTask(tester.id);
    mockMe.id = tester.id;
    mockMe.role = 'MEMBER';

    const res = await acceptTestingAction(taskId, project.key, number);
    expect(res).toEqual({ ok: true });

    const after = await prisma.task.findUnique({ where: { id: taskId } });
    expect(after?.internalStatus).toBe('REVIEW');
    expect(after?.completedAt).toBeNull();

    const comments = await prisma.comment.findMany({ where: { taskId } });
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body.startsWith('✅ Тестирование пройдено')).toBe(true);
    expect(comments[0]!.visibility).toBe('INTERNAL');
    expect(comments[0]!.authorId).toBe(tester.id);
  });

  it('accept with a note appends the note to the internal comment', async () => {
    const tester = await makeUser();
    const { project, taskId, number } = await setupTestingTask(tester.id);
    mockMe.id = tester.id;
    await acceptTestingAction(taskId, project.key, number, 'Прогнал регресс');
    const c = await prisma.comment.findFirst({ where: { taskId } });
    expect(c?.body).toMatch(/Прогнал регресс$/);
  });

  it('ADMIN can accept as fallback (task.testing.close baseline) even if not the named tester', async () => {
    const tester = await makeUser();
    const admin = await makeUser({ role: 'ADMIN' });
    const { project, taskId, number } = await setupTestingTask(tester.id);
    mockMe.id = admin.id;
    mockMe.role = 'ADMIN';
    expect(await acceptTestingAction(taskId, project.key, number)).toEqual({ ok: true });
  });

  it('non-tester MEMBER → FORBIDDEN; task stays in TESTING', async () => {
    const tester = await makeUser();
    const stranger = await makeUser();
    const { project, taskId, number } = await setupTestingTask(tester.id);
    mockMe.id = stranger.id;
    const res = await acceptTestingAction(taskId, project.key, number);
    expect(res).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Только тестировщик может принять' },
    });
    const after = await prisma.task.findUnique({ where: { id: taskId } });
    expect(after?.internalStatus).toBe('TESTING');
  });

  it('wrong state (not TESTING) → STATE error', async () => {
    const tester = await makeUser();
    const { project, taskId, number } = await setupTestingTask(tester.id);
    await prisma.task.update({
      where: { id: taskId },
      data: { internalStatus: 'IN_PROGRESS' },
    });
    mockMe.id = tester.id;
    const res = await acceptTestingAction(taskId, project.key, number);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('STATE');
  });

  it('non-existent task → NOT_FOUND', async () => {
    mockMe.id = (await makeUser({ role: 'ADMIN' })).id;
    mockMe.role = 'ADMIN';
    const res = await acceptTestingAction('00000000-0000-0000-0000-000000000000', 'X', 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_FOUND');
  });

  it('notification is queued for the assignee', async () => {
    const tester = await makeUser();
    const { project, taskId, number, assignee } = await setupTestingTask(tester.id);
    mockMe.id = tester.id;
    await acceptTestingAction(taskId, project.key, number);
    const notifs = await prisma.notification.findMany({
      where: { userId: assignee.id, kind: 'TASK_STATUS_CHANGED' },
    });
    expect(notifs.length).toBeGreaterThanOrEqual(1);
  });
});

describe('returnFromTestingAction', () => {
  it('tester can return with reason → internalStatus=IN_PROGRESS + discriminated comment', async () => {
    const tester = await makeUser();
    const { project, taskId, number } = await setupTestingTask(tester.id);
    mockMe.id = tester.id;
    const res = await returnFromTestingAction(taskId, project.key, number, 'Баг в форме');
    expect(res).toEqual({ ok: true });
    const after = await prisma.task.findUnique({ where: { id: taskId } });
    expect(after?.internalStatus).toBe('IN_PROGRESS');
    const c = await prisma.comment.findFirst({ where: { taskId } });
    // The "(тестирование)" discriminator distinguishes this loop from review's.
    expect(c?.body).toContain('Возврат на доработку (тестирование)');
    expect(c?.body).toContain('Баг в форме');
    expect(c?.visibility).toBe('INTERNAL');
  });

  it('short reason → VALIDATION (less than 3 chars after trim)', async () => {
    const tester = await makeUser();
    const { project, taskId, number } = await setupTestingTask(tester.id);
    mockMe.id = tester.id;
    const res = await returnFromTestingAction(taskId, project.key, number, '  ');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
  });

  it('non-tester → FORBIDDEN; task not in TESTING → STATE', async () => {
    const tester = await makeUser();
    const stranger = await makeUser();
    const { project, taskId, number } = await setupTestingTask(tester.id);
    mockMe.id = stranger.id;
    expect(
      await returnFromTestingAction(taskId, project.key, number, 'because'),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });

    mockMe.id = tester.id;
    await prisma.task.update({
      where: { id: taskId },
      data: { internalStatus: 'TODO' },
    });
    expect(
      await returnFromTestingAction(taskId, project.key, number, 'because'),
    ).toMatchObject({ ok: false, error: { code: 'STATE' } });
  });

  it('PM is also allowed as fallback', async () => {
    const tester = await makeUser();
    const pm = await makeUser({ role: 'PM' });
    const { project, taskId, number } = await setupTestingTask(tester.id);
    mockMe.id = pm.id;
    mockMe.role = 'PM';
    const res = await returnFromTestingAction(taskId, project.key, number, 'нужно фиксить');
    expect(res).toEqual({ ok: true });
  });
});

describe('setTesterAction', () => {
  it('PM can assign a tester and notifies them with payload.role=tester', async () => {
    const owner = await makeUser();
    const pm = await makeUser({ role: 'PM' });
    const newTester = await makeUser();
    const project = await makeProject({ ownerId: owner.id, key: 'QB' });
    const t = await makeTask({ projectId: project.id, creatorId: owner.id, number: 1 });
    mockMe.id = pm.id;
    mockMe.role = 'PM';

    const res = await setTesterAction(t.id, project.key, t.number, newTester.id);
    expect(res).toEqual({ ok: true });
    const after = await prisma.task.findUnique({ where: { id: t.id } });
    expect(after?.testerId).toBe(newTester.id);

    const notifs = await prisma.notification.findMany({
      where: { userId: newTester.id, kind: 'TASK_ASSIGNED' },
    });
    expect(notifs.length).toBeGreaterThanOrEqual(1);
    expect((notifs[0]!.payload as { role?: string })?.role).toBe('tester');
  });

  it('the sitting tester can clear themselves (self-clear escape) even without manage rights', async () => {
    const tester = await makeUser(); // plain MEMBER
    const { project, taskId, number } = await setupTestingTask(tester.id);
    mockMe.id = tester.id;
    mockMe.role = 'MEMBER';
    const res = await setTesterAction(taskId, project.key, number, null);
    expect(res).toEqual({ ok: true });
    const after = await prisma.task.findUnique({ where: { id: taskId } });
    expect(after?.testerId).toBeNull();
  });

  it('a non-manager stranger cannot assign a tester → INSUFFICIENT_PERMISSIONS', async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const target = await makeUser();
    const project = await makeProject({ ownerId: owner.id, key: 'QC' });
    const t = await makeTask({ projectId: project.id, creatorId: owner.id, number: 1 });
    mockMe.id = stranger.id;
    mockMe.role = 'MEMBER';
    const res = await setTesterAction(t.id, project.key, t.number, target.id);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });
});

describe('setInternalStatus — TESTING leave-gate', () => {
  it('no tester set → any editor may move out of TESTING', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id, key: 'QD' });
    const t = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      assigneeId: owner.id,
      number: 1,
    });
    await prisma.task.update({ where: { id: t.id }, data: { internalStatus: 'TESTING' } });
    // owner is an editor (creator + project owner); no tester set → allowed.
    await expect(
      setInternalStatus(t.id, 'REVIEW', { id: owner.id, role: 'MEMBER' }),
    ).resolves.toMatchObject({ projectKey: project.key });
    const after = await prisma.task.findUnique({ where: { id: t.id } });
    expect(after?.internalStatus).toBe('REVIEW');
  });

  it('tester set → a non-tester non-cap editor is BLOCKED from leaving TESTING', async () => {
    const owner = await makeUser();
    const tester = await makeUser();
    const project = await makeProject({ ownerId: owner.id, key: 'QE' });
    const t = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      assigneeId: owner.id,
      number: 1,
    });
    await prisma.task.update({
      where: { id: t.id },
      data: { internalStatus: 'TESTING', testerId: tester.id },
    });
    // owner is an editor but NOT the tester and has no task.testing.close cap.
    await expect(
      setInternalStatus(t.id, 'REVIEW', { id: owner.id, role: 'MEMBER' }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
    const after = await prisma.task.findUnique({ where: { id: t.id } });
    expect(after?.internalStatus).toBe('TESTING');
  });

  it('tester set → the tester themselves may leave TESTING', async () => {
    const owner = await makeUser();
    const tester = await makeUser();
    const project = await makeProject({ ownerId: owner.id, key: 'QF' });
    const t = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      assigneeId: tester.id, // tester is an editor (assignee) so the base gate passes
      number: 1,
    });
    await prisma.task.update({
      where: { id: t.id },
      data: { internalStatus: 'TESTING', testerId: tester.id },
    });
    await expect(
      setInternalStatus(t.id, 'REVIEW', { id: tester.id, role: 'MEMBER' }),
    ).resolves.toMatchObject({ projectKey: project.key });
  });

  it('tester set → a cap-holder (ADMIN) may leave TESTING', async () => {
    const owner = await makeUser();
    const tester = await makeUser();
    const admin = await makeUser({ role: 'ADMIN' });
    const project = await makeProject({ ownerId: owner.id, key: 'QG' });
    const t = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      number: 1,
    });
    await prisma.task.update({
      where: { id: t.id },
      data: { internalStatus: 'TESTING', testerId: tester.id },
    });
    await expect(
      setInternalStatus(t.id, 'REVIEW', { id: admin.id, role: 'ADMIN' }),
    ).resolves.toMatchObject({ projectKey: project.key });
  });

  it('moving INTO testing is never gated by the tester gate', async () => {
    const owner = await makeUser();
    const tester = await makeUser();
    const project = await makeProject({ ownerId: owner.id, key: 'QH' });
    const t = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      assigneeId: owner.id,
      number: 1,
    });
    await prisma.task.update({
      where: { id: t.id },
      data: { internalStatus: 'IN_PROGRESS', testerId: tester.id },
    });
    // owner is not the tester, but entering TESTING is always allowed.
    await expect(
      setInternalStatus(t.id, 'TESTING', { id: owner.id, role: 'MEMBER' }),
    ).resolves.toMatchObject({ projectKey: project.key });
    const after = await prisma.task.findUnique({ where: { id: t.id } });
    expect(after?.internalStatus).toBe('TESTING');
  });
});

describe('visibility — a tester-only user sees the task on the board', () => {
  it('listTasksForBoard returns a task where the viewer is ONLY the tester', async () => {
    const { listTasksForBoard } = await import('@/lib/tasks/listTasksForBoard');
    const { addMember } = await import('./helpers/factories');
    const owner = await makeUser();
    const tester = await makeUser();
    const project = await makeProject({ ownerId: owner.id, key: 'QI' });
    // The tester is a project member (how they'd see the project) but a plain
    // CONTRIBUTOR with no leadership bypass — so the per-stake { testerId } OR
    // (not a leadership match-all) is what surfaces this card to them.
    await addMember(project.id, tester.id, 'CONTRIBUTOR');
    const t = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      assigneeId: owner.id,
      number: 1,
      title: 'tester-only card',
    });
    await prisma.task.update({
      where: { id: t.id },
      data: { internalStatus: 'TESTING', testerId: tester.id },
    });
    // tester has NO creator/assignee/assignment/watcher stake — only testerId.
    const res = await listTasksForBoard(project.key, {}, { id: tester.id, role: 'MEMBER' });
    expect(res.tasks.map((x) => x.id)).toContain(t.id);
  });

  it('a tester-set card is NOT visible to an unrelated project member (floor is per-stake, not match-all)', async () => {
    const { listTasksForBoard } = await import('@/lib/tasks/listTasksForBoard');
    const { addMember } = await import('./helpers/factories');
    const owner = await makeUser();
    const tester = await makeUser();
    const stranger = await makeUser();
    const project = await makeProject({ ownerId: owner.id, key: 'QK' });
    await addMember(project.id, stranger.id, 'CONTRIBUTOR');
    const t = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      assigneeId: owner.id,
      number: 1,
      title: 'tester card',
    });
    await prisma.task.update({
      where: { id: t.id },
      data: { internalStatus: 'TESTING', testerId: tester.id },
    });
    // stranger is a member but has no stake on this card — and is not the tester.
    // They need at least one task-stake to pass canViewProject; give them an
    // unrelated card so the project is visible, then assert they don't see the
    // tester's card (the testerId OR must not widen to others' cards).
    const own = await makeTask({
      projectId: project.id,
      creatorId: stranger.id,
      assigneeId: stranger.id,
      number: 2,
    });
    const res = await listTasksForBoard(project.key, {}, { id: stranger.id, role: 'MEMBER' });
    const ids = res.tasks.map((x) => x.id);
    expect(ids).toContain(own.id);
    expect(ids).not.toContain(t.id);
  });

  it('a tester-only user can add a comment (canViewTask tester leg is fed)', async () => {
    const { addComment } = await import('@/lib/tasks/addComment');
    const { addMember } = await import('./helpers/factories');
    const owner = await makeUser();
    const tester = await makeUser();
    const project = await makeProject({ ownerId: owner.id, key: 'QL' });
    await addMember(project.id, tester.id, 'CONTRIBUTOR');
    const t = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      assigneeId: owner.id,
      number: 1,
    });
    // tester-only stake (no creator/assignee/assignment/watcher edge).
    await prisma.task.update({
      where: { id: t.id },
      data: { internalStatus: 'TESTING', testerId: tester.id },
    });
    const c = await addComment(t.id, 'нашёл баг в форме', { id: tester.id, role: 'MEMBER' });
    expect(c.id).toBeTruthy();
    const saved = await prisma.comment.findUnique({ where: { id: c.id } });
    expect(saved?.authorId).toBe(tester.id);
  });
});

describe('regression — REVIEW/reviewer flow still works', () => {
  it('approveTaskAction still moves REVIEW→DONE and rejectTaskAction REVIEW→IN_PROGRESS', async () => {
    const reviewer = await makeUser();
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id, key: 'QJ' });
    const t = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      assigneeId: owner.id,
      number: 1,
    });
    await prisma.task.update({
      where: { id: t.id },
      data: { internalStatus: 'REVIEW', reviewerId: reviewer.id },
    });
    mockMe.id = reviewer.id;
    mockMe.role = 'MEMBER';

    expect(await approveTaskAction(t.id, project.key, t.number)).toEqual({ ok: true });
    let after = await prisma.task.findUnique({ where: { id: t.id } });
    expect(after?.internalStatus).toBe('DONE');

    // Reset to REVIEW and exercise reject.
    await prisma.task.update({ where: { id: t.id }, data: { internalStatus: 'REVIEW', completedAt: null } });
    expect(await rejectTaskAction(t.id, project.key, t.number, 'нужно ещё')).toEqual({ ok: true });
    after = await prisma.task.findUnique({ where: { id: t.id } });
    expect(after?.internalStatus).toBe('IN_PROGRESS');
  });
});
