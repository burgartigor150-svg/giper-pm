import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Reviewer approve/reject flow. The actions live in
 *   apps/web/actions/review.ts
 *
 * Permission shape: ONLY the named reviewer (or ADMIN/PM as fallback)
 * can approve or reject. State guard: task must be in internalStatus
 * REVIEW. Side effects (internal comment, notification, audit) are
 * verified via the database — no mocks for them.
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
import { approveTaskAction, rejectTaskAction } from '@/actions/review';
import { makeProject, makeTask, makeUser } from './helpers/factories';

beforeEach(() => {
  mockMe.id = '';
  mockMe.role = 'MEMBER';
});

async function setupReviewTask(reviewerId: string | null = null) {
  const owner = await makeUser();
  const assignee = await makeUser();
  const project = await makeProject({ ownerId: owner.id, key: 'RVW' });
  const t = await makeTask({
    projectId: project.id,
    creatorId: owner.id,
    assigneeId: assignee.id,
    number: 1,
    title: 'Needs review',
  });
  await prisma.task.update({
    where: { id: t.id },
    data: { internalStatus: 'REVIEW', reviewerId },
  });
  return { owner, assignee, project, taskId: t.id, number: t.number };
}

describe('approveTaskAction', () => {
  it('reviewer can approve → internalStatus=DONE + completedAt + internal comment + audit ping', async () => {
    const reviewer = await makeUser();
    const { project, taskId, number } = await setupReviewTask(reviewer.id);
    mockMe.id = reviewer.id;
    mockMe.role = 'MEMBER';

    const res = await approveTaskAction(taskId, project.key, number);
    expect(res).toEqual({ ok: true });

    const after = await prisma.task.findUnique({ where: { id: taskId } });
    expect(after?.internalStatus).toBe('DONE');
    expect(after?.completedAt).toBeInstanceOf(Date);

    const comments = await prisma.comment.findMany({ where: { taskId } });
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body.startsWith('✅ Одобрено')).toBe(true);
    expect(comments[0]!.visibility).toBe('INTERNAL');
    expect(comments[0]!.authorId).toBe(reviewer.id);
  });

  it('approve with a note appends the note to the internal comment', async () => {
    const reviewer = await makeUser();
    const { project, taskId, number } = await setupReviewTask(reviewer.id);
    mockMe.id = reviewer.id;
    await approveTaskAction(taskId, project.key, number, 'Looks good, ship it');
    const c = await prisma.comment.findFirst({ where: { taskId } });
    expect(c?.body).toMatch(/Looks good, ship it$/);
  });

  it('ADMIN can approve as fallback even if not the named reviewer', async () => {
    const reviewer = await makeUser();
    const admin = await makeUser({ role: 'ADMIN' });
    const { project, taskId, number } = await setupReviewTask(reviewer.id);
    mockMe.id = admin.id;
    mockMe.role = 'ADMIN';
    expect(await approveTaskAction(taskId, project.key, number)).toEqual({ ok: true });
  });

  it('non-reviewer MEMBER → FORBIDDEN', async () => {
    const reviewer = await makeUser();
    const stranger = await makeUser();
    const { project, taskId, number } = await setupReviewTask(reviewer.id);
    mockMe.id = stranger.id;
    const res = await approveTaskAction(taskId, project.key, number);
    expect(res).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Только ревьюер может закрыть' },
    });
    const after = await prisma.task.findUnique({ where: { id: taskId } });
    expect(after?.internalStatus).toBe('REVIEW');
  });

  it('wrong state (not REVIEW) → STATE error', async () => {
    const reviewer = await makeUser();
    const { project, taskId, number } = await setupReviewTask(reviewer.id);
    await prisma.task.update({
      where: { id: taskId },
      data: { internalStatus: 'IN_PROGRESS' },
    });
    mockMe.id = reviewer.id;
    const res = await approveTaskAction(taskId, project.key, number);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('STATE');
  });

  it('non-existent task → NOT_FOUND', async () => {
    mockMe.id = (await makeUser({ role: 'ADMIN' })).id;
    mockMe.role = 'ADMIN';
    const res = await approveTaskAction(
      '00000000-0000-0000-0000-000000000000',
      'X',
      1,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_FOUND');
  });

  it('notification is queued for the assignee', async () => {
    const reviewer = await makeUser();
    const { project, taskId, number, assignee } = await setupReviewTask(reviewer.id);
    mockMe.id = reviewer.id;
    await approveTaskAction(taskId, project.key, number);
    const notifs = await prisma.notification.findMany({
      where: { userId: assignee.id, kind: 'TASK_STATUS_CHANGED' },
    });
    expect(notifs.length).toBeGreaterThanOrEqual(1);
  });
});

describe('rejectTaskAction', () => {
  it('reviewer can reject with reason → internalStatus=IN_PROGRESS + internal comment', async () => {
    const reviewer = await makeUser();
    const { project, taskId, number } = await setupReviewTask(reviewer.id);
    mockMe.id = reviewer.id;
    const res = await rejectTaskAction(taskId, project.key, number, 'Не закрыты тесты');
    expect(res).toEqual({ ok: true });
    const after = await prisma.task.findUnique({ where: { id: taskId } });
    expect(after?.internalStatus).toBe('IN_PROGRESS');
    const c = await prisma.comment.findFirst({ where: { taskId } });
    expect(c?.body).toContain('Возврат на доработку');
    expect(c?.body).toContain('Не закрыты тесты');
    expect(c?.visibility).toBe('INTERNAL');
  });

  it('short reason → VALIDATION (less than 3 chars after trim)', async () => {
    const reviewer = await makeUser();
    const { project, taskId, number } = await setupReviewTask(reviewer.id);
    mockMe.id = reviewer.id;
    const res = await rejectTaskAction(taskId, project.key, number, '  ');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
  });

  it('non-reviewer → FORBIDDEN; task not in REVIEW → STATE', async () => {
    const reviewer = await makeUser();
    const stranger = await makeUser();
    const { project, taskId, number } = await setupReviewTask(reviewer.id);
    mockMe.id = stranger.id;
    expect(
      await rejectTaskAction(taskId, project.key, number, 'because'),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });

    mockMe.id = reviewer.id;
    await prisma.task.update({
      where: { id: taskId },
      data: { internalStatus: 'TODO' },
    });
    expect(
      await rejectTaskAction(taskId, project.key, number, 'because'),
    ).toMatchObject({ ok: false, error: { code: 'STATE' } });
  });

  it('PM is also allowed as fallback', async () => {
    const reviewer = await makeUser();
    const pm = await makeUser({ role: 'PM' });
    const { project, taskId, number } = await setupReviewTask(reviewer.id);
    mockMe.id = pm.id;
    mockMe.role = 'PM';
    const res = await rejectTaskAction(taskId, project.key, number, 'нужно фиксить');
    expect(res).toEqual({ ok: true });
  });
});
