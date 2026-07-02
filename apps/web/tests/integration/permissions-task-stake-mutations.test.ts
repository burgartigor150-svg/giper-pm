import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import { addComment } from '@/lib/tasks/addComment';
import { createTask } from '@/lib/tasks/createTask';
import { setInternalStatus } from '@/lib/tasks/setInternalStatus';
import { moveTaskToColumn } from '@/lib/tasks/moveTaskToColumn';
import { createProject } from '@/lib/projects';
import { makeUser, makeProject, makeTask, addMember, sessionUser } from './helpers/factories';

/**
 * Follow-up to the write-gate task-stake fix: adjacent mutation gates found by
 * the mutation-surface audit that block a legitimate stakeholder the read gates
 * already admit. Policy applied: active stakeholders (creator / assignee /
 * co-assignee / reviewer / tester) + leadership may edit / move / change status;
 * observers (watchers) may view + comment but NOT change status / move cards.
 */

async function mirror(ownerId: string, key: string) {
  const p = await makeProject({ ownerId, key });
  await prisma.project.update({
    where: { id: p.id },
    data: { externalSource: 'bitrix24', externalId: `wg-${p.id}` },
  });
  return p;
}

/** Like `mirror`, but via createProject so real BoardColumn rows are materialized. */
async function mirrorWithColumns(admin: { id: string; role: 'ADMIN' }, key: string) {
  const p = await createProject({ name: `Board ${key}`, key }, sessionUser(admin));
  await prisma.project.update({
    where: { id: p.id },
    data: { externalSource: 'bitrix24', externalId: `wg-${p.id}` },
  });
  return p;
}

describe('addComment — native-project LEAD (no personal stake) can comment', () => {
  it('a LEAD member who is not owner and not on the task can post a comment', async () => {
    const owner = await makeUser();
    const lead = await makeUser({ role: 'MEMBER' });
    const project = await makeProject({ ownerId: owner.id, key: 'AC' }); // native
    await addMember(project.id, lead.id, 'LEAD');
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });

    const c = await addComment(task.id, 'Комментарий от лида', sessionUser(lead));
    expect(c.id).toBeTruthy();
  });
});

describe('createTask — assignee may be a Bitrix colleague or task participant', () => {
  it('accepts an assignee who is a Bitrix workgroup member (not native member)', async () => {
    const owner = await makeUser();
    const colleague = await makeUser({ role: 'MEMBER' });
    const project = await mirror(owner.id, 'CB');
    await prisma.projectBitrixMember.create({
      data: { projectId: project.id, bitrixUserId: 'bx-col', userId: colleague.id },
    });

    const created = await createTask(
      { projectKey: project.key, title: 'С исполнителем', assigneeId: colleague.id, tags: [] },
      sessionUser(owner),
    );
    const t = await prisma.task.findUniqueOrThrow({ where: { id: created.id } });
    expect(t.assigneeId).toBe(colleague.id);
  });

  it('still rejects an assignee with no relationship to the project', async () => {
    const owner = await makeUser();
    const stranger = await makeUser({ role: 'MEMBER' });
    const project = await mirror(owner.id, 'CS');

    await expect(
      createTask(
        { projectKey: project.key, title: 'Чужому', assigneeId: stranger.id, tags: [] },
        sessionUser(owner),
      ),
    ).rejects.toMatchObject({ name: 'DomainError', code: 'VALIDATION' });
  });
});

describe('setInternalStatus — active stakeholders may move the card', () => {
  it('the named reviewer can send a card back out of REVIEW (board/picker path)', async () => {
    const owner = await makeUser();
    const reviewer = await makeUser({ role: 'MEMBER' });
    const assignee = await makeUser({ role: 'MEMBER' });
    const project = await mirror(owner.id, 'SR');
    const task = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      assigneeId: assignee.id,
      internalStatus: 'REVIEW',
    });
    await prisma.task.update({ where: { id: task.id }, data: { reviewerId: reviewer.id } });

    const r = await setInternalStatus(task.id, 'IN_PROGRESS', sessionUser(reviewer));
    expect(r.number).toBe(task.number);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.internalStatus).toBe('IN_PROGRESS');
  });

  it('a co-assignee can move the card TODO → IN_PROGRESS', async () => {
    const owner = await makeUser();
    const coassignee = await makeUser({ role: 'MEMBER' });
    const project = await mirror(owner.id, 'SC');
    const task = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      internalStatus: 'TODO',
    });
    await prisma.taskAssignment.create({ data: { taskId: task.id, userId: coassignee.id, position: 'BACKEND', createdById: owner.id } });

    await setInternalStatus(task.id, 'IN_PROGRESS', sessionUser(coassignee));
    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.internalStatus).toBe('IN_PROGRESS');
  });

  it('a mere watcher CANNOT change status', async () => {
    const owner = await makeUser();
    const watcher = await makeUser({ role: 'MEMBER' });
    const project = await mirror(owner.id, 'SW');
    const task = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      internalStatus: 'TODO',
    });
    await prisma.taskWatcher.create({ data: { taskId: task.id, userId: watcher.id } });

    await expect(
      setInternalStatus(task.id, 'IN_PROGRESS', sessionUser(watcher)),
    ).rejects.toMatchObject({ name: 'DomainError', code: 'INSUFFICIENT_PERMISSIONS' });
  });
});

describe('moveTaskToColumn — active stakeholders may move; watchers may not', () => {
  it('a co-assignee can move the task to another column', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    const coassignee = await makeUser({ role: 'MEMBER' });
    const project = await mirrorWithColumns(owner, 'MC');
    const task = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      internalStatus: 'TODO',
    });
    await prisma.taskAssignment.create({ data: { taskId: task.id, userId: coassignee.id, position: 'BACKEND', createdById: owner.id } });
    const target = await prisma.boardColumn.findFirstOrThrow({
      where: { projectId: project.id, status: 'IN_PROGRESS' },
    });

    const r = await moveTaskToColumn(task.id, target.id, sessionUser(coassignee));
    expect(r.projectKey).toBe(project.key);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.columnId).toBe(target.id);
  });

  it('a mere watcher CANNOT move the task', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    const watcher = await makeUser({ role: 'MEMBER' });
    const project = await mirrorWithColumns(owner, 'MW');
    const task = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      internalStatus: 'TODO',
    });
    await prisma.taskWatcher.create({ data: { taskId: task.id, userId: watcher.id } });
    const target = await prisma.boardColumn.findFirstOrThrow({
      where: { projectId: project.id, status: 'IN_PROGRESS' },
    });

    await expect(
      moveTaskToColumn(task.id, target.id, sessionUser(watcher)),
    ).rejects.toMatchObject({ name: 'DomainError', code: 'INSUFFICIENT_PERMISSIONS' });
  });
});
