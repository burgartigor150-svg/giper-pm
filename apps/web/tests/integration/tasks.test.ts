import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import {
  addComment,
  assignTask,
  changeTaskStatus,
  createTask,
  deleteTask,
  getTask,
  listRecentTasksForProject,
  listTasksForBoard,
  listTasksForProject,
  updateTask,
} from '@/lib/tasks';
import { DomainError } from '@/lib/errors';
import { TASKS_PAGE_SIZE, type TaskListFilter } from '@giper/shared';
import {
  addMember,
  makeProject,
  makeTask,
  makeUser,
  sessionUser,
} from './helpers/factories';

const baseFilter = (over: Partial<TaskListFilter> = {}): TaskListFilter => ({
  page: 1,
  sort: 'number',
  dir: 'desc',
  ...over,
});

// =============================================================================
// createTask
// =============================================================================

describe('createTask', () => {
  it('happy path: number = max+1, audit row written, defaults applied', async () => {
    const owner = await makeUser({ role: 'MEMBER' });
    const project = await makeProject({ ownerId: owner.id });
    // Pre-existing task to confirm number starts max+1.
    await makeTask({ projectId: project.id, creatorId: owner.id, number: 5 });

    const created = await createTask(
      { projectKey: project.key, title: 'New work', tags: [] },
      sessionUser(owner),
    );

    expect(created.number).toBe(6);
    const row = await prisma.task.findUnique({ where: { id: created.id } });
    expect(row?.creatorId).toBe(owner.id);
    expect(row?.priority).toBe('MEDIUM');
    expect(row?.type).toBe('TASK');
    expect(row?.status).toBe('BACKLOG');

    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'Task', entityId: created.id, action: 'task.create' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.userId).toBe(owner.id);
  });

  it('first task in project gets number 1', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const created = await createTask(
      { projectKey: project.key, title: 'first', tags: [] },
      sessionUser(owner),
    );
    expect(created.number).toBe(1);
  });

  it('VIEWER role → 403', async () => {
    const owner = await makeUser();
    const viewer = await makeUser({ role: 'VIEWER' });
    const project = await makeProject({ ownerId: owner.id });
    await addMember(project.id, viewer.id, 'OBSERVER');

    await expect(
      createTask(
        { projectKey: project.key, title: 'x', tags: [] },
        sessionUser(viewer),
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS', status: 403 });
  });

  it('non-member MEMBER → 403 (canViewProject denies)', async () => {
    const owner = await makeUser();
    const stranger = await makeUser({ role: 'MEMBER' });
    const project = await makeProject({ ownerId: owner.id });

    await expect(
      createTask(
        { projectKey: project.key, title: 'x', tags: [] },
        sessionUser(stranger),
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
  });

  it('assignee not in project → VALIDATION 400', async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const project = await makeProject({ ownerId: owner.id });

    await expect(
      createTask(
        {
          projectKey: project.key,
          title: 'x',
          tags: [],
          assigneeId: stranger.id,
        },
        sessionUser(owner),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION', status: 400 });
  });

  it('assigning to project owner is allowed even without explicit member row', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const created = await createTask(
      {
        projectKey: project.key,
        title: 'x',
        tags: [],
        assigneeId: owner.id,
      },
      sessionUser(owner),
    );
    const row = await prisma.task.findUnique({ where: { id: created.id } });
    expect(row?.assigneeId).toBe(owner.id);
  });

  it('10 parallel createTask calls all succeed with unique sequential numbers', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        createTask(
          { projectKey: project.key, title: `parallel-${i}`, tags: [] },
          sessionUser(owner),
        ),
      ),
    );

    const numbers = results.map((r) => r.number).sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const count = await prisma.task.count({ where: { projectId: project.id } });
    expect(count).toBe(10);
  });

  it('project not found → NOT_FOUND', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    await expect(
      createTask(
        { projectKey: 'XX', title: 'x', tags: [] },
        sessionUser(owner),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('ADMIN can create even outside project membership', async () => {
    const owner = await makeUser();
    const admin = await makeUser({ role: 'ADMIN' });
    const project = await makeProject({ ownerId: owner.id });

    const created = await createTask(
      { projectKey: project.key, title: 'admin-task', tags: [] },
      sessionUser(admin),
    );
    expect(created.number).toBe(1);
  });
});

// =============================================================================
// updateTask
// =============================================================================

describe('updateTask', () => {
  it('creator can edit', async () => {
    const owner = await makeUser();
    const creator = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    await addMember(project.id, creator.id, 'CONTRIBUTOR');
    const task = await makeTask({
      projectId: project.id,
      creatorId: creator.id,
      title: 'old',
    });

    const out = await updateTask(
      task.id,
      { title: 'new', tags: [] },
      sessionUser(creator),
    );
    expect(out.title).toBe('new');
  });

  it('assignee can edit', async () => {
    const owner = await makeUser();
    const assignee = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    await addMember(project.id, assignee.id, 'CONTRIBUTOR');
    const task = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      assigneeId: assignee.id,
      title: 'old',
    });

    const out = await updateTask(
      task.id,
      { title: 'new-by-assignee', tags: [] },
      sessionUser(assignee),
    );
    expect(out.title).toBe('new-by-assignee');
  });

  it('LEAD member can edit', async () => {
    const owner = await makeUser();
    const lead = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    await addMember(project.id, lead.id, 'LEAD');
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });

    await expect(
      updateTask(task.id, { title: 'updated', tags: [] }, sessionUser(lead)),
    ).resolves.toBeTruthy();
  });

  it('owner can edit', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    await addMember(project.id, member.id, 'CONTRIBUTOR');
    const task = await makeTask({ projectId: project.id, creatorId: member.id });

    await expect(
      updateTask(task.id, { title: 'by-owner', tags: [] }, sessionUser(owner)),
    ).resolves.toBeTruthy();
  });

  it('ADMIN can edit', async () => {
    const owner = await makeUser();
    const admin = await makeUser({ role: 'ADMIN' });
    const project = await makeProject({ ownerId: owner.id });
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });
    await expect(
      updateTask(task.id, { title: 'a', tags: [] }, sessionUser(admin)),
    ).resolves.toBeTruthy();
  });

  it('random MEMBER cannot edit', async () => {
    const owner = await makeUser();
    const stranger = await makeUser({ role: 'MEMBER' });
    const project = await makeProject({ ownerId: owner.id });
    await addMember(project.id, stranger.id, 'CONTRIBUTOR');
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });
    await expect(
      updateTask(task.id, { title: 'nope', tags: [] }, sessionUser(stranger)),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
  });

  it('audit task.update lists only changed keys; description body becomes <changed>', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const task = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      title: 'old',
    });
    await prisma.task.update({
      where: { id: task.id },
      data: { description: 'old desc' },
    });

    await updateTask(
      task.id,
      {
        title: 'new title',
        description: 'new and secret description',
        priority: 'HIGH',
        tags: [],
      },
      sessionUser(owner),
    );

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: task.id, action: 'task.update' },
    });
    expect(audit).not.toBeNull();
    const diff = audit!.diff as Record<string, { from: unknown; to: unknown }>;
    expect(diff.title).toEqual({ from: 'old', to: 'new title' });
    expect(diff.priority).toEqual({ from: 'MEDIUM', to: 'HIGH' });
    expect(diff.description).toEqual({ from: '<changed>', to: '<changed>' });
    // Unchanged keys must NOT appear.
    expect(diff.type).toBeUndefined();
    expect(diff.estimateHours).toBeUndefined();
  });

  it('empty diff (same values) → audit NOT written', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const task = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      title: 'same',
    });

    // Same title, no actual change.
    await updateTask(task.id, { title: 'same', tags: [] }, sessionUser(owner));

    const audits = await prisma.auditLog.count({
      where: { entityId: task.id, action: 'task.update' },
    });
    expect(audits).toBe(0);
  });

  it('task not found → NOT_FOUND', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    await expect(
      updateTask('bogus-id', { tags: [] }, sessionUser(u)),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

// =============================================================================
// changeTaskStatus
// =============================================================================

describe('changeTaskStatus', () => {
  it('BACKLOG → IN_PROGRESS sets startedAt, completedAt stays null, audit + status change written', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const task = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      status: 'BACKLOG',
    });

    const out = await changeTaskStatus(task.id, 'IN_PROGRESS', sessionUser(owner));
    expect(out.status).toBe('IN_PROGRESS');
    expect(out.startedAt).not.toBeNull();
    expect(out.completedAt).toBeNull();

    const change = await prisma.taskStatusChange.findFirst({
      where: { taskId: task.id },
    });
    expect(change?.fromStatus).toBe('BACKLOG');
    expect(change?.toStatus).toBe('IN_PROGRESS');
    expect(change?.changedById).toBe(owner.id);

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: task.id, action: 'task.status_change' },
    });
    expect(audit).not.toBeNull();
  });

  it('IN_PROGRESS → DONE sets completedAt', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const task = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      status: 'IN_PROGRESS',
    });
    await prisma.task.update({
      where: { id: task.id },
      data: { startedAt: new Date(Date.now() - 10_000) },
    });

    const out = await changeTaskStatus(task.id, 'DONE', sessionUser(owner));
    expect(out.status).toBe('DONE');
    expect(out.completedAt).not.toBeNull();
    expect(out.startedAt).not.toBeNull();
  });

  it('DONE → IN_PROGRESS clears completedAt (reopen)', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const task = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      status: 'DONE',
    });
    await prisma.task.update({
      where: { id: task.id },
      data: {
        startedAt: new Date(Date.now() - 60_000),
        completedAt: new Date(),
      },
    });

    const out = await changeTaskStatus(task.id, 'IN_PROGRESS', sessionUser(owner));
    expect(out.status).toBe('IN_PROGRESS');
    expect(out.completedAt).toBeNull();
  });

  it('same-status no-op: no TaskStatusChange or audit written', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const task = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      status: 'TODO',
    });

    const out = await changeTaskStatus(task.id, 'TODO', sessionUser(owner));
    expect(out.status).toBe('TODO');

    expect(
      await prisma.taskStatusChange.count({ where: { taskId: task.id } }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { entityId: task.id, action: 'task.status_change' },
      }),
    ).toBe(0);
  });

  it('non-editor → 403', async () => {
    const owner = await makeUser();
    const stranger = await makeUser({ role: 'MEMBER' });
    const project = await makeProject({ ownerId: owner.id });
    await addMember(project.id, stranger.id, 'CONTRIBUTOR');
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });

    await expect(
      changeTaskStatus(task.id, 'IN_PROGRESS', sessionUser(stranger)),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
  });

  it('preserves existing startedAt when re-entering IN_PROGRESS', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const task = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      status: 'BLOCKED',
    });
    const original = new Date('2024-01-01T10:00:00Z');
    await prisma.task.update({
      where: { id: task.id },
      data: { startedAt: original },
    });
    const out = await changeTaskStatus(task.id, 'IN_PROGRESS', sessionUser(owner));
    expect(out.startedAt?.toISOString()).toBe(original.toISOString());
  });
});

// =============================================================================
// assignTask
// =============================================================================

describe('assignTask', () => {
  it('assigning a non-member → VALIDATION 400', async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });

    await expect(
      assignTask(task.id, stranger.id, sessionUser(owner)),
    ).rejects.toMatchObject({ code: 'VALIDATION', status: 400 });
  });

  it('same assignee → no-op (no audit)', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    await addMember(project.id, member.id, 'CONTRIBUTOR');
    const task = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      assigneeId: member.id,
    });

    await assignTask(task.id, member.id, sessionUser(owner));

    const audits = await prisma.auditLog.count({
      where: { entityId: task.id, action: 'task.assign' },
    });
    expect(audits).toBe(0);
  });

  it('null assignee unassigns and writes audit with after.assigneeId=null', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    await addMember(project.id, member.id, 'CONTRIBUTOR');
    const task = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      assigneeId: member.id,
    });

    const out = await assignTask(task.id, null, sessionUser(owner));
    expect(out.assigneeId).toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: task.id, action: 'task.assign' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    const diff = audit!.diff as { after: { assigneeId: string | null } };
    expect(diff.after.assigneeId).toBeNull();
  });

  it('assigning project owner is OK without explicit ProjectMember row', async () => {
    const owner = await makeUser();
    const lead = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    await addMember(project.id, lead.id, 'LEAD');
    const task = await makeTask({ projectId: project.id, creatorId: lead.id });

    const out = await assignTask(task.id, owner.id, sessionUser(lead));
    expect(out.assigneeId).toBe(owner.id);
  });

  it('non-editor cannot assign → 403', async () => {
    const owner = await makeUser();
    const stranger = await makeUser({ role: 'MEMBER' });
    const project = await makeProject({ ownerId: owner.id });
    await addMember(project.id, stranger.id, 'CONTRIBUTOR');
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });

    await expect(
      assignTask(task.id, owner.id, sessionUser(stranger)),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
  });
});

// =============================================================================
// addComment
// =============================================================================

describe('addComment', () => {
  it('VIEWER project member can comment', async () => {
    const owner = await makeUser();
    const viewer = await makeUser({ role: 'VIEWER' });
    const project = await makeProject({ ownerId: owner.id });
    await addMember(project.id, viewer.id, 'OBSERVER');
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });

    const out = await addComment(task.id, 'hi', sessionUser(viewer));
    expect(out.body).toBe('hi');
    const row = await prisma.comment.findUnique({ where: { id: out.id } });
    expect(row?.authorId).toBe(viewer.id);
    expect(row?.source).toBe('WEB');
  });

  it('regular member can comment', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    await addMember(project.id, member.id, 'CONTRIBUTOR');
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });

    const out = await addComment(task.id, 'comment body', sessionUser(member));
    expect(out.body).toBe('comment body');
  });

  it('non-member → 403', async () => {
    const owner = await makeUser();
    const stranger = await makeUser({ role: 'MEMBER' });
    const project = await makeProject({ ownerId: owner.id });
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });

    await expect(
      addComment(task.id, 'no', sessionUser(stranger)),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
  });

  it('passes through custom source (TELEGRAM)', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });

    const out = await addComment(task.id, 'tg', sessionUser(owner), 'TELEGRAM');
    const row = await prisma.comment.findUnique({ where: { id: out.id } });
    expect(row?.source).toBe('TELEGRAM');
  });

  it('task not found → NOT_FOUND', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    await expect(
      addComment('nope', 'x', sessionUser(u)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// =============================================================================
// deleteTask
// =============================================================================

describe('deleteTask', () => {
  it('ADMIN can delete', async () => {
    const owner = await makeUser();
    const admin = await makeUser({ role: 'ADMIN' });
    const project = await makeProject({ ownerId: owner.id });
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });

    await deleteTask(task.id, sessionUser(admin));
    expect(await prisma.task.findUnique({ where: { id: task.id } })).toBeNull();
  });

  it('owner can delete', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });
    await deleteTask(task.id, sessionUser(owner));
    expect(await prisma.task.findUnique({ where: { id: task.id } })).toBeNull();
  });

  it('PM can delete', async () => {
    const owner = await makeUser();
    const pm = await makeUser({ role: 'PM' });
    const project = await makeProject({ ownerId: owner.id });
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });
    await deleteTask(task.id, sessionUser(pm));
    expect(await prisma.task.findUnique({ where: { id: task.id } })).toBeNull();
  });

  it('LEAD can delete', async () => {
    const owner = await makeUser();
    const lead = await makeUser({ role: 'MEMBER' });
    const project = await makeProject({ ownerId: owner.id });
    await addMember(project.id, lead.id, 'LEAD');
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });
    await deleteTask(task.id, sessionUser(lead));
    expect(await prisma.task.findUnique({ where: { id: task.id } })).toBeNull();
  });

  it('CONTRIBUTOR cannot delete', async () => {
    const owner = await makeUser();
    const member = await makeUser({ role: 'MEMBER' });
    const project = await makeProject({ ownerId: owner.id });
    await addMember(project.id, member.id, 'CONTRIBUTOR');
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });

    await expect(
      deleteTask(task.id, sessionUser(member)),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
  });

  it('cannot delete with subtasks → VALIDATION 400', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const parent = await makeTask({ projectId: project.id, creatorId: owner.id });
    const sub = await makeTask({ projectId: project.id, creatorId: owner.id });
    await prisma.task.update({
      where: { id: sub.id },
      data: { parentId: parent.id },
    });

    await expect(
      deleteTask(parent.id, sessionUser(owner)),
    ).rejects.toMatchObject({ code: 'VALIDATION', status: 400 });
  });

  it('audit task.delete row exists AFTER task is deleted', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });

    await deleteTask(task.id, sessionUser(owner));
    expect(await prisma.task.findUnique({ where: { id: task.id } })).toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'Task', entityId: task.id, action: 'task.delete' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.userId).toBe(owner.id);
  });

  it('comments cascade-delete; TimeEntry.taskId becomes null but row survives', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });
    await addComment(task.id, 'will die', sessionUser(owner));
    const te = await prisma.timeEntry.create({
      data: {
        userId: owner.id,
        taskId: task.id,
        startedAt: new Date(Date.now() - 60_000),
        endedAt: new Date(),
        durationMin: 1,
        source: 'MANUAL_FORM',
      },
    });

    await deleteTask(task.id, sessionUser(owner));

    expect(
      await prisma.comment.count({ where: { taskId: task.id } }),
    ).toBe(0);
    const teAfter = await prisma.timeEntry.findUnique({ where: { id: te.id } });
    expect(teAfter).not.toBeNull();
    expect(teAfter?.taskId).toBeNull();
  });

  it('non-existent task → NOT_FOUND', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    await expect(
      deleteTask('bogus', sessionUser(admin)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// =============================================================================
// listTasksForProject
// =============================================================================

describe('listTasksForProject', () => {
  it('pagination: 60 tasks, page=1 returns 50, page=2 returns 10', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    for (let i = 0; i < 60; i++) {
      await prisma.task.create({
        data: {
          projectId: project.id,
          number: i + 1,
          title: `t-${i}`,
          creatorId: owner.id,
        },
      });
    }

    const p1 = await listTasksForProject(
      project.key,
      baseFilter({ page: 1 }),
      sessionUser(owner),
    );
    expect(p1.items).toHaveLength(TASKS_PAGE_SIZE);
    expect(p1.total).toBe(60);
    expect(p1.pageCount).toBe(2);

    const p2 = await listTasksForProject(
      project.key,
      baseFilter({ page: 2 }),
      sessionUser(owner),
    );
    expect(p2.items).toHaveLength(10);
  });

  it('filter status', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    await makeTask({ projectId: project.id, creatorId: owner.id, status: 'TODO' });
    await makeTask({ projectId: project.id, creatorId: owner.id, status: 'DONE' });
    await makeTask({ projectId: project.id, creatorId: owner.id, status: 'DONE' });

    const out = await listTasksForProject(
      project.key,
      baseFilter({ status: 'DONE' }),
      sessionUser(owner),
    );
    expect(out.total).toBe(2);
    expect(out.items.every((t) => t.status === 'DONE')).toBe(true);
  });

  it('filter priority', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const t = await makeTask({ projectId: project.id, creatorId: owner.id });
    await prisma.task.update({ where: { id: t.id }, data: { priority: 'URGENT' } });
    await makeTask({ projectId: project.id, creatorId: owner.id });

    const out = await listTasksForProject(
      project.key,
      baseFilter({ priority: 'URGENT' }),
      sessionUser(owner),
    );
    expect(out.total).toBe(1);
  });

  it('filter assigneeId', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    await addMember(project.id, member.id, 'CONTRIBUTOR');
    await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      assigneeId: member.id,
    });
    await makeTask({ projectId: project.id, creatorId: owner.id });

    const out = await listTasksForProject(
      project.key,
      baseFilter({ assigneeId: member.id }),
      sessionUser(owner),
    );
    expect(out.total).toBe(1);
    expect(out.items[0]?.assignee?.id).toBe(member.id);
  });

  it('filter q is case-insensitive on title', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      title: 'Awesome Feature',
    });
    await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      title: 'Boring chore',
    });

    const out = await listTasksForProject(
      project.key,
      baseFilter({ q: 'awesome' }),
      sessionUser(owner),
    );
    expect(out.total).toBe(1);
    expect(out.items[0]?.title).toBe('Awesome Feature');
  });

  it('sort by number asc/desc', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    for (let i = 1; i <= 3; i++) {
      await prisma.task.create({
        data: {
          projectId: project.id,
          number: i,
          title: `t-${i}`,
          creatorId: owner.id,
        },
      });
    }
    const asc = await listTasksForProject(
      project.key,
      baseFilter({ sort: 'number', dir: 'asc' }),
      sessionUser(owner),
    );
    expect(asc.items.map((t) => t.number)).toEqual([1, 2, 3]);

    const desc = await listTasksForProject(
      project.key,
      baseFilter({ sort: 'number', dir: 'desc' }),
      sessionUser(owner),
    );
    expect(desc.items.map((t) => t.number)).toEqual([3, 2, 1]);
  });

  it('sort by title', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    await makeTask({ projectId: project.id, creatorId: owner.id, title: 'Banana' });
    await makeTask({ projectId: project.id, creatorId: owner.id, title: 'Apple' });
    await makeTask({ projectId: project.id, creatorId: owner.id, title: 'Cherry' });

    const out = await listTasksForProject(
      project.key,
      baseFilter({ sort: 'title', dir: 'asc' }),
      sessionUser(owner),
    );
    expect(out.items.map((t) => t.title)).toEqual(['Apple', 'Banana', 'Cherry']);
  });

  it('sort by status, priority, estimateHours, dueDate (smoke)', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    await makeTask({ projectId: project.id, creatorId: owner.id });
    await makeTask({ projectId: project.id, creatorId: owner.id });

    for (const sort of ['status', 'priority', 'estimateHours', 'dueDate'] as const) {
      const out = await listTasksForProject(
        project.key,
        baseFilter({ sort, dir: 'asc' }),
        sessionUser(owner),
      );
      expect(out.items).toHaveLength(2);
    }
  });

  it('sort by assignee.name', async () => {
    const owner = await makeUser();
    const aaa = await makeUser({ name: 'AAA' });
    const zzz = await makeUser({ name: 'ZZZ' });
    const project = await makeProject({ ownerId: owner.id });
    await addMember(project.id, aaa.id, 'CONTRIBUTOR');
    await addMember(project.id, zzz.id, 'CONTRIBUTOR');
    await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      assigneeId: aaa.id,
      title: 'A',
    });
    await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      assigneeId: zzz.id,
      title: 'Z',
    });

    const out = await listTasksForProject(
      project.key,
      baseFilter({ sort: 'assignee', dir: 'asc' }),
      sessionUser(owner),
    );
    expect(out.items[0]?.assignee?.name).toBe('AAA');
    expect(out.items[1]?.assignee?.name).toBe('ZZZ');
  });

  it('VIEWER on project they do not belong to → 403', async () => {
    const owner = await makeUser();
    const viewer = await makeUser({ role: 'VIEWER' });
    const project = await makeProject({ ownerId: owner.id });
    await expect(
      listTasksForProject(project.key, baseFilter(), sessionUser(viewer)),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
  });

  it('project not found → NOT_FOUND', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    await expect(
      listTasksForProject('XX', baseFilter(), sessionUser(admin)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('pageCount is at least 1 even for empty project', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const out = await listTasksForProject(
      project.key,
      baseFilter(),
      sessionUser(owner),
    );
    expect(out.total).toBe(0);
    expect(out.pageCount).toBe(1);
  });
});

// =============================================================================
// listTasksForBoard
// =============================================================================

describe('listTasksForBoard', () => {
  it('returns only non-CANCELED tasks', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    await makeTask({ projectId: project.id, creatorId: owner.id, status: 'TODO' });
    await makeTask({ projectId: project.id, creatorId: owner.id, status: 'DONE' });
    await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      status: 'CANCELED',
    });

    const out = await listTasksForBoard(project.key, {}, sessionUser(owner));
    expect(out.tasks).toHaveLength(2);
    expect(out.tasks.every((t) => t.status !== 'CANCELED')).toBe(true);
  });

  it('onlyMine overrides assigneeId filter', async () => {
    const owner = await makeUser();
    const me = await makeUser();
    const other = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    await addMember(project.id, me.id, 'CONTRIBUTOR');
    await addMember(project.id, other.id, 'CONTRIBUTOR');
    await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      assigneeId: me.id,
    });
    await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      assigneeId: other.id,
    });

    const out = await listTasksForBoard(
      project.key,
      { onlyMine: true, assigneeId: other.id },
      sessionUser(me),
    );
    expect(out.tasks).toHaveLength(1);
    expect(out.tasks[0]?.assignee?.id).toBe(me.id);
  });

  it('filters compose: priority + q', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const t1 = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      title: 'urgent fix',
    });
    await prisma.task.update({
      where: { id: t1.id },
      data: { priority: 'URGENT' },
    });
    await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      title: 'urgent talk',
    }); // MEDIUM priority
    const t3 = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      title: 'normal stuff',
    });
    await prisma.task.update({
      where: { id: t3.id },
      data: { priority: 'URGENT' },
    });

    const out = await listTasksForBoard(
      project.key,
      { priority: 'URGENT', q: 'urgent' },
      sessionUser(owner),
    );
    expect(out.tasks).toHaveLength(1);
    expect(out.tasks[0]?.title).toBe('urgent fix');
  });

  it('non-viewer → 403', async () => {
    const owner = await makeUser();
    const stranger = await makeUser({ role: 'MEMBER' });
    const project = await makeProject({ ownerId: owner.id });
    await expect(
      listTasksForBoard(project.key, {}, sessionUser(stranger)),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
  });

  it('returns embedded project info', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const out = await listTasksForBoard(project.key, {}, sessionUser(owner));
    expect(out.project.key).toBe(project.key);
  });
});

// =============================================================================
// listRecentTasksForProject
// =============================================================================

describe('listRecentTasksForProject', () => {
  it('returns up to limit, ordered by updatedAt desc', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const t1 = await makeTask({ projectId: project.id, creatorId: owner.id });
    await new Promise((r) => setTimeout(r, 10));
    const t2 = await makeTask({ projectId: project.id, creatorId: owner.id });
    await new Promise((r) => setTimeout(r, 10));
    const t3 = await makeTask({ projectId: project.id, creatorId: owner.id });

    const out = await listRecentTasksForProject(project.id, 2);
    expect(out).toHaveLength(2);
    expect(out[0]?.id).toBe(t3.id);
    expect(out[1]?.id).toBe(t2.id);
    void t1;
  });

  it('default limit is 5', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    for (let i = 0; i < 7; i++) {
      await makeTask({ projectId: project.id, creatorId: owner.id });
    }
    const out = await listRecentTasksForProject(project.id);
    expect(out).toHaveLength(5);
  });
});

// =============================================================================
// getTask
// =============================================================================

describe('getTask', () => {
  it('non-existent number → NOT_FOUND', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    await expect(
      getTask(project.key, 999, sessionUser(owner)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('wrong project key → NOT_FOUND', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    await expect(
      getTask('XX', 1, sessionUser(owner)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('non-viewer → INSUFFICIENT_PERMISSIONS', async () => {
    const owner = await makeUser();
    const stranger = await makeUser({ role: 'MEMBER' });
    const project = await makeProject({ ownerId: owner.id });
    const task = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      number: 1,
    });

    await expect(
      getTask(project.key, task.number, sessionUser(stranger)),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
  });

  it('includes comments + statusChanges sorted ascending', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const task = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      number: 1,
      status: 'BACKLOG',
    });

    await addComment(task.id, 'first', sessionUser(owner));
    await new Promise((r) => setTimeout(r, 5));
    await addComment(task.id, 'second', sessionUser(owner));

    await changeTaskStatus(task.id, 'TODO', sessionUser(owner));
    await new Promise((r) => setTimeout(r, 5));
    await changeTaskStatus(task.id, 'IN_PROGRESS', sessionUser(owner));

    const detail = await getTask(project.key, 1, sessionUser(owner));
    expect(detail.comments).toHaveLength(2);
    expect(detail.comments[0]?.body).toBe('first');
    expect(detail.comments[1]?.body).toBe('second');
    expect(detail.statusChanges).toHaveLength(2);
    expect(detail.statusChanges[0]?.toStatus).toBe('TODO');
    expect(detail.statusChanges[1]?.toStatus).toBe('IN_PROGRESS');
  });

  it('PM can view any project task', async () => {
    const owner = await makeUser();
    const pm = await makeUser({ role: 'PM' });
    const project = await makeProject({ ownerId: owner.id });
    await makeTask({ projectId: project.id, creatorId: owner.id, number: 1 });

    const detail = await getTask(project.key, 1, sessionUser(pm));
    expect(detail.number).toBe(1);
  });
});
