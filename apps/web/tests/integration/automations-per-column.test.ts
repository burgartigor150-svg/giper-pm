import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Per-column automations (the "same-category move black hole" fix). Verifies:
 *  - a same-category free-form column move now FIRES column-enter automations
 *    (historically it fired nothing), without touching internalStatus/stamps;
 *  - a column-keyed rule ({columnId}) fires ONLY on its exact column, never a
 *    sibling same-category column;
 *  - a cross-category move fires column-keyed rules for the destination column;
 *  - updateAutomationsAction validates/persists the column-keyed trigger and
 *    rejects a foreign column id.
 * Source: actions/board.ts setTaskColumnAction, lib/automations/runColumnEnterAutomations.ts,
 * actions/automations.ts.
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
import { updateAutomationsAction } from '@/actions/automations';
import { getAutomations } from '@/lib/board/getAutomations';
import { makeUser, makeProject, makeTask } from './helpers/factories';

beforeEach(() => {
  mockMe.role = 'ADMIN';
});

async function priorityRule(
  projectId: string,
  trig: { status?: string; columnId?: string },
  priority: string,
) {
  return prisma.automationRule.create({
    data: {
      projectId,
      name: 'rule',
      enabled: true,
      trigger: 'CARD_ENTERS_COLUMN',
      triggerConfig: trig,
      actionType: 'SET_PRIORITY',
      actionConfig: { priority },
      order: 0,
    },
  });
}

describe('per-column automations — engine via setTaskColumnAction', () => {
  it('same-category move fires the destination COLUMN rule but NOT a category rule (the felt-bug fix), status track untouched', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const member = await makeUser({ role: 'MEMBER' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id });
    const col = await createBoardColumnAction(project.id, 'К выполнению', 'TODO');
    if (!col.ok) throw new Error('setup');
    const task = await makeTask({ projectId: project.id, creatorId: admin.id, internalStatus: 'TODO' });
    await prisma.task.update({ where: { id: task.id }, data: { priority: 'LOW', assigneeId: null } });
    // Category rule (must NOT fire on an intra-category move) + column rule (must fire).
    await priorityRule(project.id, { status: 'TODO' }, 'URGENT');
    await prisma.automationRule.create({
      data: {
        projectId: project.id,
        name: 'col-assign',
        enabled: true,
        trigger: 'CARD_ENTERS_COLUMN',
        triggerConfig: { columnId: col.data!.columnId },
        actionType: 'SET_ASSIGNEE',
        actionConfig: { userId: member.id },
        order: 1,
      },
    });

    const res = await setTaskColumnAction(task.id, col.data!.columnId);
    expect(res.ok).toBe(true);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.priority).toBe('LOW'); // category rule did NOT re-fire on intra-category move
    expect(after.assigneeId).toBe(member.id); // column rule fired
    expect(after.internalStatus).toBe('TODO'); // status track untouched
    expect(after.completedAt).toBeNull();
    expect(await prisma.taskStatusChange.count({ where: { taskId: task.id } })).toBe(0);
  });

  it('a COLUMN-keyed rule fires only on its exact column, not a sibling same-category column', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id });
    const dev = await createBoardColumnAction(project.id, 'Разработка', 'IN_PROGRESS');
    const qa = await createBoardColumnAction(project.id, 'Тестирование', 'IN_PROGRESS');
    if (!dev.ok || !qa.ok) throw new Error('setup');
    const task = await makeTask({ projectId: project.id, creatorId: admin.id, internalStatus: 'IN_PROGRESS' });
    await prisma.task.update({ where: { id: task.id }, data: { priority: 'LOW' } });
    await priorityRule(project.id, { columnId: qa.data!.columnId }, 'HIGH');

    // Same-category move into Dev — the QA-keyed rule must NOT fire.
    expect((await setTaskColumnAction(task.id, dev.data!.columnId)).ok).toBe(true);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).priority).toBe('LOW');

    // Same-category move into QA — now it fires.
    expect((await setTaskColumnAction(task.id, qa.data!.columnId)).ok).toBe(true);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.priority).toBe('HIGH');
    expect(after.internalStatus).toBe('IN_PROGRESS'); // still no category change
  });

  it('a cross-category move fires BOTH the new-category rule and the destination column rule', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const member = await makeUser({ role: 'MEMBER' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id });
    const qa = await createBoardColumnAction(project.id, 'Тестирование', 'IN_PROGRESS');
    if (!qa.ok) throw new Error('setup');
    const task = await makeTask({ projectId: project.id, creatorId: admin.id, internalStatus: 'TODO' });
    await prisma.task.update({ where: { id: task.id }, data: { priority: 'LOW', assigneeId: null } });
    // Category rule for the NEW category fires (the card enters IN_PROGRESS) AND
    // the destination column rule fires.
    await priorityRule(project.id, { status: 'IN_PROGRESS' }, 'HIGH');
    await prisma.automationRule.create({
      data: {
        projectId: project.id,
        name: 'col-assign',
        enabled: true,
        trigger: 'CARD_ENTERS_COLUMN',
        triggerConfig: { columnId: qa.data!.columnId },
        actionType: 'SET_ASSIGNEE',
        actionConfig: { userId: member.id },
        order: 1,
      },
    });

    // TODO → QA(IN_PROGRESS): cross-category, routes through the status core which
    // threads the destination columnId so both the category and column rules fire.
    expect((await setTaskColumnAction(task.id, qa.data!.columnId)).ok).toBe(true);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.priority).toBe('HIGH'); // category rule fired (card entered IN_PROGRESS)
    expect(after.assigneeId).toBe(member.id); // column rule fired
    expect(after.internalStatus).toBe('IN_PROGRESS');
    expect(after.columnId).toBe(qa.data!.columnId);
  });

  it('a column-keyed rule does NOT fire on a category-only change (no column context)', async () => {
    // When a rule is column-keyed but the move carries no columnId (e.g. the
    // task-detail picker), it must stay silent — guards the per-column matcher.
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id });
    const qa = await createBoardColumnAction(project.id, 'Тестирование', 'IN_PROGRESS');
    if (!qa.ok) throw new Error('setup');
    const task = await makeTask({ projectId: project.id, creatorId: admin.id, internalStatus: 'IN_PROGRESS' });
    await prisma.task.update({ where: { id: task.id }, data: { priority: 'LOW' } });
    await priorityRule(project.id, { columnId: qa.data!.columnId }, 'HIGH');

    const { runColumnEnterAutomations } = await import('@/lib/automations/runColumnEnterAutomations');
    await runColumnEnterAutomations(task.id, 'IN_PROGRESS'); // no columnId
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).priority).toBe('LOW');
  });
});

describe('updateAutomationsAction — column-keyed trigger validation', () => {
  it('stores a column-keyed trigger and round-trips triggerColumnId', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id });
    const qa = await createBoardColumnAction(project.id, 'Тестирование', 'IN_PROGRESS');
    if (!qa.ok) throw new Error('setup');

    const res = await updateAutomationsAction(project.id, [
      {
        id: null,
        name: 'QA → high',
        enabled: true,
        triggerType: 'CARD_ENTERS_COLUMN',
        triggerStatus: 'IN_PROGRESS',
        triggerColumnId: qa.data!.columnId,
        actionType: 'SET_PRIORITY',
        actionValue: 'HIGH',
        order: 0,
      },
    ]);
    expect(res.ok).toBe(true);
    const rules = await getAutomations(project.id);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.triggerColumnId).toBe(qa.data!.columnId);
    expect(rules[0]?.triggerStatus).toBe(''); // column mode → no category
  });

  it('rejects a column id from another project', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id });
    const other = await makeProject({ ownerId: admin.id });
    const foreign = await createBoardColumnAction(other.id, 'Чужая', 'TODO');
    if (!foreign.ok) throw new Error('setup');

    const res = await updateAutomationsAction(project.id, [
      {
        id: null,
        name: 'bad',
        enabled: true,
        triggerType: 'CARD_ENTERS_COLUMN',
        triggerStatus: 'TODO',
        triggerColumnId: foreign.data!.columnId,
        actionType: 'SET_PRIORITY',
        actionValue: 'HIGH',
        order: 0,
      },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
    expect(await prisma.automationRule.count({ where: { projectId: project.id } })).toBe(0);
  });

  it('keeps storing a category trigger when no columnId is given (back-compat)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id });

    const res = await updateAutomationsAction(project.id, [
      {
        id: null,
        name: 'cat',
        enabled: true,
        triggerType: 'CARD_ENTERS_COLUMN',
        triggerStatus: 'DONE',
        triggerColumnId: '',
        actionType: 'SET_PRIORITY',
        actionValue: 'HIGH',
        order: 0,
      },
    ]);
    expect(res.ok).toBe(true);
    const rules = await getAutomations(project.id);
    expect(rules[0]?.triggerStatus).toBe('DONE');
    expect(rules[0]?.triggerColumnId).toBe('');
  });
});
