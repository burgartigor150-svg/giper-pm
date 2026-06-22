import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Configurable workflow — phase 1 (transition allowlist). Verifies the helper's
 * inert default + allowlist semantics, enforcement at the team-board chokepoint
 * (setInternalStatusAction), and the editor action's gate + replace semantics.
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
import { isTransitionAllowed } from '@/lib/workflow/isTransitionAllowed';
import { setWorkflowTransitionsAction } from '@/actions/workflow';
import { setInternalStatusAction } from '@/actions/assignments';
import { changeTaskStatus } from '@/lib/tasks';
import { setInternalStatus } from '@/lib/tasks/setInternalStatus';
import { makeUser, makeProject, addMember, makeTask } from './helpers/factories';

function as(u: { id: string; role: 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER' }) {
  mockMe.id = u.id;
  mockMe.role = u.role;
}
beforeEach(() => {
  mockMe.role = 'ADMIN';
});

describe('isTransitionAllowed', () => {
  it('inert when no rules: every move allowed', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'WFA' });
    expect(await isTransitionAllowed(p.id, 'TODO', 'DONE')).toBe(true);
    expect(await isTransitionAllowed(p.id, 'BACKLOG', 'IN_PROGRESS')).toBe(true);
  });

  it('with rules: only allowlisted edges (plus from===to and →CANCELED) allowed', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'WFB' });
    as(admin);
    await setWorkflowTransitionsAction(p.key, [
      { from: 'TODO', to: 'IN_PROGRESS' },
      { from: 'IN_PROGRESS', to: 'REVIEW' },
    ]);
    expect(await isTransitionAllowed(p.id, 'TODO', 'IN_PROGRESS')).toBe(true);
    expect(await isTransitionAllowed(p.id, 'IN_PROGRESS', 'REVIEW')).toBe(true);
    expect(await isTransitionAllowed(p.id, 'TODO', 'DONE')).toBe(false); // not allowlisted
    expect(await isTransitionAllowed(p.id, 'IN_PROGRESS', 'IN_PROGRESS')).toBe(true); // no-op
    expect(await isTransitionAllowed(p.id, 'TODO', 'CANCELED')).toBe(true); // escape hatch
  });
});

describe('setInternalStatusAction enforcement', () => {
  it('enforces the allowlist on the board move (inert project = unchanged)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'WFC' });
    const task = await makeTask({ projectId: p.id, creatorId: admin.id });
    await prisma.task.update({ where: { id: task.id }, data: { internalStatus: 'TODO' } });
    as(admin);

    // inert: any move ok (closing to DONE now needs a result/итог).
    expect(
      (await setInternalStatusAction(task.id, p.key, task.number, 'DONE', 'итог')).ok,
    ).toBe(true);
    await prisma.task.update({ where: { id: task.id }, data: { internalStatus: 'TODO' } });

    // configure: only TODO→IN_PROGRESS
    await setWorkflowTransitionsAction(p.key, [{ from: 'TODO', to: 'IN_PROGRESS' }]);
    const ok = await setInternalStatusAction(task.id, p.key, task.number, 'IN_PROGRESS');
    expect(ok.ok).toBe(true);
    await prisma.task.update({ where: { id: task.id }, data: { internalStatus: 'TODO' } });

    const denied = await setInternalStatusAction(task.id, p.key, task.number, 'REVIEW');
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('TRANSITION_NOT_ALLOWED');
    // task stayed in TODO
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).internalStatus).toBe('TODO');

    // CANCELED always allowed even when not in the list
    expect((await setInternalStatusAction(task.id, p.key, task.number, 'CANCELED')).ok).toBe(true);
  });

  it('changeTaskStatus (native board / bulk track) is gated too — no split-brain', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'WFE' });
    // native task: status TODO, no externalSource
    const task = await makeTask({ projectId: p.id, creatorId: admin.id, status: 'TODO' });
    as(admin);
    await setWorkflowTransitionsAction(p.key, [{ from: 'TODO', to: 'IN_PROGRESS' }]);

    // disallowed mirror-track move throws → status stays TODO (no divergence)
    await expect(
      changeTaskStatus(task.id, 'REVIEW', { id: admin.id, role: 'ADMIN' }),
    ).rejects.toThrow();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('TODO');

    // allowed move succeeds
    const moved = await changeTaskStatus(task.id, 'IN_PROGRESS', { id: admin.id, role: 'ADMIN' });
    expect(moved.status).toBe('IN_PROGRESS');
  });
});

describe('setWorkflowTransitionsAction — gate + replace', () => {
  it('a plain member cannot edit; an owner can; replace + clear + sanitize', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'WFD' });
    const member = await makeUser({ role: 'MEMBER' });
    await addMember(p.id, member.id, 'CONTRIBUTOR');

    as(member);
    expect((await setWorkflowTransitionsAction(p.key, [{ from: 'TODO', to: 'DONE' }])).ok).toBe(false);

    as(admin);
    // sanitize: self-edge + unknown status dropped; valid kept
    await setWorkflowTransitionsAction(p.key, [
      { from: 'TODO', to: 'TODO' }, // self → dropped
      { from: 'TODO', to: 'NOPE' }, // unknown → dropped
      { from: 'TODO', to: 'IN_PROGRESS' },
    ]);
    expect(await prisma.workflowTransition.count({ where: { projectId: p.id } })).toBe(1);

    // replace
    await setWorkflowTransitionsAction(p.key, [
      { from: 'IN_PROGRESS', to: 'REVIEW' },
      { from: 'REVIEW', to: 'DONE' },
    ]);
    const rows = await prisma.workflowTransition.findMany({ where: { projectId: p.id } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.fromStatus !== 'TODO')).toBe(true); // old set gone

    // clear → unrestricted again
    await setWorkflowTransitionsAction(p.key, []);
    expect(await prisma.workflowTransition.count({ where: { projectId: p.id } })).toBe(0);
  });
});

describe('setInternalStatus — close requires итог', () => {
  it('rejects closing (DONE) without a result', async () => {
    const owner = await makeUser();
    const p = await makeProject({ ownerId: owner.id, key: 'CLR1' });
    const t = await makeTask({ projectId: p.id, creatorId: owner.id });
    await expect(
      setInternalStatus(t.id, 'DONE', { id: owner.id, role: owner.role }),
    ).rejects.toThrow(/итог/i);
    // unchanged
    const after = await prisma.task.findUnique({
      where: { id: t.id },
      select: { internalStatus: true, completionResult: true },
    });
    expect(after?.internalStatus).not.toBe('DONE');
    expect(after?.completionResult).toBeNull();
  });

  it('saves completionResult + posts an "Итог" comment on close', async () => {
    const owner = await makeUser();
    const p = await makeProject({ ownerId: owner.id, key: 'CLR2' });
    const t = await makeTask({ projectId: p.id, creatorId: owner.id });
    await setInternalStatus(t.id, 'DONE', { id: owner.id, role: owner.role }, { result: '  Выкатили в прод  ' });
    const after = await prisma.task.findUnique({
      where: { id: t.id },
      select: { internalStatus: true, completionResult: true, completedAt: true },
    });
    expect(after?.internalStatus).toBe('DONE');
    expect(after?.completionResult).toBe('Выкатили в прод'); // trimmed
    expect(after?.completedAt).not.toBeNull();
    const comments = await prisma.comment.findMany({ where: { taskId: t.id } });
    expect(comments.some((c) => c.body === 'Итог: Выкатили в прод')).toBe(true);
  });

  it('re-closing an already-DONE task is a no-op (no duplicate Итог comment)', async () => {
    const owner = await makeUser();
    const p = await makeProject({ ownerId: owner.id, key: 'CLR4' });
    const t = await makeTask({ projectId: p.id, creatorId: owner.id });
    await setInternalStatus(t.id, 'DONE', { id: owner.id, role: owner.role }, { result: 'Первый итог' });
    // Second close — even without a result — must not throw and must not add a
    // second comment.
    await setInternalStatus(t.id, 'DONE', { id: owner.id, role: owner.role });
    const comments = await prisma.comment.findMany({ where: { taskId: t.id } });
    expect(comments.filter((c) => c.body.startsWith('Итог:'))).toHaveLength(1);
  });

  it('does not require a result for non-DONE transitions', async () => {
    const owner = await makeUser();
    const p = await makeProject({ ownerId: owner.id, key: 'CLR3' });
    const t = await makeTask({ projectId: p.id, creatorId: owner.id });
    await setInternalStatus(t.id, 'IN_PROGRESS', { id: owner.id, role: owner.role });
    const after = await prisma.task.findUnique({
      where: { id: t.id },
      select: { internalStatus: true, completionResult: true },
    });
    expect(after?.internalStatus).toBe('IN_PROGRESS');
    expect(after?.completionResult).toBeNull();
  });
});
