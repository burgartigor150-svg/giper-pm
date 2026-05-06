import { describe, it, expect } from 'vitest';
import { prisma, type UserRole, type MemberRole } from '@giper/db';
import {
  addComment, assignTask, changeTaskStatus, createTask, deleteTask, getTask,
  listRecentTasksForProject, listTasksForBoard, listTasksForProject, updateTask,
} from '@/lib/tasks';
import { DomainError } from '@/lib/errors';
import { TASKS_PAGE_SIZE, type TaskListFilter } from '@giper/shared';
import { addMember, makeProject, makeTask, makeUser, sessionUser } from './helpers/factories';

const F = (over: Partial<TaskListFilter> = {}): TaskListFilter =>
  ({ page: 1, sort: 'number', dir: 'desc', ...over });

/** Project + owner + optional extra members in one shot. */
async function scaffold(
  ownerRole: UserRole = 'MEMBER',
  members: { role?: UserRole; member?: MemberRole }[] = [],
) {
  const owner = await makeUser({ role: ownerRole });
  const project = await makeProject({ ownerId: owner.id });
  const extras = await Promise.all(members.map(async (m) => {
    const u = await makeUser({ role: m.role ?? 'MEMBER' });
    await addMember(project.id, u.id, m.member ?? 'CONTRIBUTOR');
    return u;
  }));
  return { owner, project, extras };
}
const auditCount = (entityId: string, action: string) =>
  prisma.auditLog.count({ where: { entityId, action } });

// ============================================================================
// createTask
// ============================================================================
describe('createTask', () => {
  it('happy: number=max+1, audit row written, defaults applied', async () => {
    const { owner, project } = await scaffold();
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
    expect(await auditCount(created.id, 'task.create')).toBe(1);
  });

  it('first task gets number 1; ADMIN creates outside membership', async () => {
    const { project } = await scaffold();
    const admin = await makeUser({ role: 'ADMIN' });
    const t = await createTask({ projectKey: project.key, title: 'first', tags: [] }, sessionUser(admin));
    expect(t.number).toBe(1);
  });

  it('VIEWER role → 403', async () => {
    const { project } = await scaffold();
    const viewer = await makeUser({ role: 'VIEWER' });
    await addMember(project.id, viewer.id, 'OBSERVER');
    await expect(createTask({ projectKey: project.key, title: 'x', tags: [] }, sessionUser(viewer)))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS', status: 403 });
  });

  it('non-member MEMBER → 403', async () => {
    const { project } = await scaffold();
    const stranger = await makeUser({ role: 'MEMBER' });
    await expect(createTask({ projectKey: project.key, title: 'x', tags: [] }, sessionUser(stranger)))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
  });

  it('assignee not in project → VALIDATION 400', async () => {
    const { owner, project } = await scaffold();
    const stranger = await makeUser();
    await expect(
      createTask(
        { projectKey: project.key, title: 'x', tags: [], assigneeId: stranger.id },
        sessionUser(owner),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION', status: 400 });
  });

  it('assigning project owner is allowed without explicit member row', async () => {
    const { owner, project } = await scaffold();
    const t = await createTask(
      { projectKey: project.key, title: 'x', tags: [], assigneeId: owner.id },
      sessionUser(owner),
    );
    const row = await prisma.task.findUnique({ where: { id: t.id } });
    expect(row?.assigneeId).toBe(owner.id);
  });

  it('10 parallel calls all succeed with unique sequential numbers', async () => {
    const { owner, project } = await scaffold();
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      createTask({ projectKey: project.key, title: `p-${i}`, tags: [] }, sessionUser(owner))));
    expect(results.map((r) => r.number).sort((a, b) => a - b)).toEqual([1,2,3,4,5,6,7,8,9,10]);
    expect(await prisma.task.count({ where: { projectId: project.id } })).toBe(10);
  });

  it('project not found → NOT_FOUND', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    await expect(createTask({ projectKey: 'XX', title: 'x', tags: [] }, sessionUser(owner)))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});

// ============================================================================
// updateTask
// ============================================================================
describe('updateTask', () => {
  it('creator/assignee/LEAD/owner/ADMIN can edit', async () => {
    const owner = await makeUser();
    const lead = await makeUser();
    const assignee = await makeUser();
    const creator = await makeUser();
    const admin = await makeUser({ role: 'ADMIN' });
    const project = await makeProject({ ownerId: owner.id });
    await addMember(project.id, lead.id, 'LEAD');
    await addMember(project.id, assignee.id, 'CONTRIBUTOR');
    await addMember(project.id, creator.id, 'CONTRIBUTOR');
    const tCreator = await makeTask({ projectId: project.id, creatorId: creator.id });
    const tAssignee = await makeTask({ projectId: project.id, creatorId: owner.id, assigneeId: assignee.id });
    const tLead = await makeTask({ projectId: project.id, creatorId: owner.id });
    const tOwner = await makeTask({ projectId: project.id, creatorId: lead.id });
    const tAdmin = await makeTask({ projectId: project.id, creatorId: owner.id });
    for (const [t, actor] of [[tCreator, creator], [tAssignee, assignee], [tLead, lead], [tOwner, owner], [tAdmin, admin]] as const) {
      await expect(updateTask(t.id, { title: 'new', tags: [] }, sessionUser(actor))).resolves.toBeTruthy();
    }
  });

  it('random MEMBER cannot edit', async () => {
    const { owner, project, extras } = await scaffold('MEMBER', [{}]);
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });
    await expect(updateTask(task.id, { title: 'x', tags: [] }, sessionUser(extras[0]!)))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
  });

  it('audit lists only changed keys; description body becomes <changed>', async () => {
    const { owner, project } = await scaffold();
    const task = await makeTask({ projectId: project.id, creatorId: owner.id, title: 'old' });
    await prisma.task.update({ where: { id: task.id }, data: { description: 'old desc' } });
    await updateTask(
      task.id,
      { title: 'new title', description: 'secret', priority: 'HIGH', tags: [] },
      sessionUser(owner),
    );
    const audit = await prisma.auditLog.findFirst({ where: { entityId: task.id, action: 'task.update' } });
    const diff = audit!.diff as Record<string, { from: unknown; to: unknown }>;
    expect(diff.title).toEqual({ from: 'old', to: 'new title' });
    expect(diff.priority).toEqual({ from: 'MEDIUM', to: 'HIGH' });
    expect(diff.description).toEqual({ from: '<changed>', to: '<changed>' });
    expect(diff.type).toBeUndefined();
    expect(diff.estimateHours).toBeUndefined();
  });

  it('empty diff → audit NOT written', async () => {
    const { owner, project } = await scaffold();
    const task = await makeTask({ projectId: project.id, creatorId: owner.id, title: 'same' });
    await updateTask(task.id, { title: 'same', tags: [] }, sessionUser(owner));
    expect(await auditCount(task.id, 'task.update')).toBe(0);
  });

  it('task not found → NOT_FOUND', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    await expect(updateTask('bogus-id', { tags: [] }, sessionUser(u))).rejects.toBeInstanceOf(DomainError);
  });
});

// ============================================================================
// changeTaskStatus
// ============================================================================
describe('changeTaskStatus', () => {
  it('BACKLOG → IN_PROGRESS sets startedAt; audit + status row written', async () => {
    const { owner, project } = await scaffold();
    const task = await makeTask({ projectId: project.id, creatorId: owner.id, status: 'BACKLOG' });
    const out = await changeTaskStatus(task.id, 'IN_PROGRESS', sessionUser(owner));
    expect(out.status).toBe('IN_PROGRESS');
    expect(out.startedAt).not.toBeNull();
    expect(out.completedAt).toBeNull();
    const change = await prisma.taskStatusChange.findFirst({ where: { taskId: task.id } });
    expect(change?.fromStatus).toBe('BACKLOG');
    expect(change?.toStatus).toBe('IN_PROGRESS');
    expect(change?.changedById).toBe(owner.id);
    expect(await auditCount(task.id, 'task.status_change')).toBe(1);
  });

  it('IN_PROGRESS → DONE sets completedAt; DONE → IN_PROGRESS clears it', async () => {
    const { owner, project } = await scaffold();
    const task = await makeTask({ projectId: project.id, creatorId: owner.id, status: 'IN_PROGRESS' });
    await prisma.task.update({ where: { id: task.id }, data: { startedAt: new Date(Date.now() - 10_000) } });
    const done = await changeTaskStatus(task.id, 'DONE', sessionUser(owner));
    expect(done.completedAt).not.toBeNull();
    expect(done.startedAt).not.toBeNull();
    const reopened = await changeTaskStatus(task.id, 'IN_PROGRESS', sessionUser(owner));
    expect(reopened.completedAt).toBeNull();
  });

  it('same-status no-op: no TaskStatusChange or audit', async () => {
    const { owner, project } = await scaffold();
    const task = await makeTask({ projectId: project.id, creatorId: owner.id, status: 'TODO' });
    await changeTaskStatus(task.id, 'TODO', sessionUser(owner));
    expect(await prisma.taskStatusChange.count({ where: { taskId: task.id } })).toBe(0);
    expect(await auditCount(task.id, 'task.status_change')).toBe(0);
  });

  it('non-editor → 403', async () => {
    const { owner, project, extras } = await scaffold('MEMBER', [{}]);
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });
    await expect(changeTaskStatus(task.id, 'IN_PROGRESS', sessionUser(extras[0]!)))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
  });

  it('preserves existing startedAt when re-entering IN_PROGRESS', async () => {
    const { owner, project } = await scaffold();
    const task = await makeTask({ projectId: project.id, creatorId: owner.id, status: 'BLOCKED' });
    const orig = new Date('2024-01-01T10:00:00Z');
    await prisma.task.update({ where: { id: task.id }, data: { startedAt: orig } });
    const out = await changeTaskStatus(task.id, 'IN_PROGRESS', sessionUser(owner));
    expect(out.startedAt?.toISOString()).toBe(orig.toISOString());
  });
});

// ============================================================================
// assignTask
// ============================================================================
describe('assignTask', () => {
  it('assigning a non-member → VALIDATION 400', async () => {
    const { owner, project } = await scaffold();
    const stranger = await makeUser();
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });
    await expect(assignTask(task.id, stranger.id, sessionUser(owner)))
      .rejects.toMatchObject({ code: 'VALIDATION', status: 400 });
  });

  it('same assignee → no-op (no audit)', async () => {
    const { owner, project, extras } = await scaffold('MEMBER', [{}]);
    const member = extras[0]!;
    const task = await makeTask({ projectId: project.id, creatorId: owner.id, assigneeId: member.id });
    await assignTask(task.id, member.id, sessionUser(owner));
    expect(await auditCount(task.id, 'task.assign')).toBe(0);
  });

  it('null assignee unassigns; audit has after.assigneeId=null', async () => {
    const { owner, project, extras } = await scaffold('MEMBER', [{}]);
    const member = extras[0]!;
    const task = await makeTask({ projectId: project.id, creatorId: owner.id, assigneeId: member.id });
    const out = await assignTask(task.id, null, sessionUser(owner));
    expect(out.assigneeId).toBeNull();
    const audit = await prisma.auditLog.findFirst({ where: { entityId: task.id, action: 'task.assign' } });
    const diff = audit!.diff as { after: { assigneeId: string | null } };
    expect(diff.after.assigneeId).toBeNull();
  });

  it('assigning project owner is OK without ProjectMember row', async () => {
    const { owner, project, extras } = await scaffold('MEMBER', [{ member: 'LEAD' }]);
    const lead = extras[0]!;
    const task = await makeTask({ projectId: project.id, creatorId: lead.id });
    const out = await assignTask(task.id, owner.id, sessionUser(lead));
    expect(out.assigneeId).toBe(owner.id);
  });

  it('non-editor cannot assign → 403', async () => {
    const { owner, project, extras } = await scaffold('MEMBER', [{}]);
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });
    await expect(assignTask(task.id, owner.id, sessionUser(extras[0]!)))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
  });
});

// ============================================================================
// addComment
// ============================================================================
describe('addComment', () => {
  it('VIEWER project member can comment', async () => {
    const { owner, project } = await scaffold();
    const viewer = await makeUser({ role: 'VIEWER' });
    await addMember(project.id, viewer.id, 'OBSERVER');
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });
    const out = await addComment(task.id, 'hi', sessionUser(viewer));
    expect(out.body).toBe('hi');
    const row = await prisma.comment.findUnique({ where: { id: out.id } });
    expect(row?.authorId).toBe(viewer.id);
    expect(row?.source).toBe('WEB');
  });

  it('non-member → 403; passes through custom source; task not found → NOT_FOUND', async () => {
    const { owner, project } = await scaffold();
    const stranger = await makeUser({ role: 'MEMBER' });
    const admin = await makeUser({ role: 'ADMIN' });
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });
    await expect(addComment(task.id, 'no', sessionUser(stranger)))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
    const out = await addComment(task.id, 'tg', sessionUser(owner), 'TELEGRAM');
    const row = await prisma.comment.findUnique({ where: { id: out.id } });
    expect(row?.source).toBe('TELEGRAM');
    await expect(addComment('nope', 'x', sessionUser(admin)))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// ============================================================================
// deleteTask
// ============================================================================
describe('deleteTask', () => {
  it('ADMIN/owner/PM/LEAD can delete; CONTRIBUTOR cannot', async () => {
    const owner = await makeUser();
    const pm = await makeUser({ role: 'PM' });
    const admin = await makeUser({ role: 'ADMIN' });
    const lead = await makeUser({ role: 'MEMBER' });
    const member = await makeUser({ role: 'MEMBER' });
    const project = await makeProject({ ownerId: owner.id });
    await addMember(project.id, lead.id, 'LEAD');
    await addMember(project.id, member.id, 'CONTRIBUTOR');
    for (const actor of [admin, owner, pm, lead]) {
      const t = await makeTask({ projectId: project.id, creatorId: owner.id });
      await deleteTask(t.id, sessionUser(actor));
      expect(await prisma.task.findUnique({ where: { id: t.id } })).toBeNull();
    }
    const t = await makeTask({ projectId: project.id, creatorId: owner.id });
    await expect(deleteTask(t.id, sessionUser(member)))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
  });

  it('cannot delete with subtasks → VALIDATION 400', async () => {
    const { owner, project } = await scaffold();
    const parent = await makeTask({ projectId: project.id, creatorId: owner.id });
    const sub = await makeTask({ projectId: project.id, creatorId: owner.id });
    await prisma.task.update({ where: { id: sub.id }, data: { parentId: parent.id } });
    await expect(deleteTask(parent.id, sessionUser(owner)))
      .rejects.toMatchObject({ code: 'VALIDATION', status: 400 });
  });

  it('audit row exists AFTER deletion; comments cascade; TimeEntry.taskId nulled', async () => {
    const { owner, project } = await scaffold();
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });
    await addComment(task.id, 'x', sessionUser(owner));
    const te = await prisma.timeEntry.create({
      data: {
        userId: owner.id, taskId: task.id,
        startedAt: new Date(Date.now() - 60_000), endedAt: new Date(),
        durationMin: 1, source: 'MANUAL_FORM',
      },
    });
    await deleteTask(task.id, sessionUser(owner));
    expect(await prisma.task.findUnique({ where: { id: task.id } })).toBeNull();
    expect(await auditCount(task.id, 'task.delete')).toBe(1);
    expect(await prisma.comment.count({ where: { taskId: task.id } })).toBe(0);
    const teAfter = await prisma.timeEntry.findUnique({ where: { id: te.id } });
    expect(teAfter).not.toBeNull();
    expect(teAfter?.taskId).toBeNull();
  });

  it('non-existent task → NOT_FOUND', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    await expect(deleteTask('bogus', sessionUser(admin)))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// ============================================================================
// listTasksForProject
// ============================================================================
describe('listTasksForProject', () => {
  it('pagination: 60 tasks → page 1=50, page 2=10, pageCount=2', async () => {
    const { owner, project } = await scaffold();
    await prisma.task.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        projectId: project.id, number: i + 1, title: `t-${i}`, creatorId: owner.id,
      })),
    });
    const p1 = await listTasksForProject(project.key, F({ page: 1 }), sessionUser(owner));
    expect(p1.items).toHaveLength(TASKS_PAGE_SIZE);
    expect(p1.total).toBe(60);
    expect(p1.pageCount).toBe(2);
    const p2 = await listTasksForProject(project.key, F({ page: 2 }), sessionUser(owner));
    expect(p2.items).toHaveLength(10);
  });

  it('filters: status, priority, assigneeId, q (case-insensitive)', async () => {
    const { owner, project, extras } = await scaffold('MEMBER', [{}]);
    const member = extras[0]!;
    const t1 = await makeTask({
      projectId: project.id, creatorId: owner.id, status: 'DONE', title: 'Awesome Feature',
    });
    await prisma.task.update({ where: { id: t1.id }, data: { priority: 'URGENT' } });
    await makeTask({
      projectId: project.id, creatorId: owner.id, status: 'TODO', title: 'Boring chore',
    });
    await makeTask({
      projectId: project.id, creatorId: owner.id, assigneeId: member.id, status: 'TODO',
    });
    expect(
      (await listTasksForProject(project.key, F({ status: 'TODO' }), sessionUser(owner))).total,
    ).toBe(2);
    expect(
      (await listTasksForProject(project.key, F({ priority: 'URGENT' }), sessionUser(owner))).total,
    ).toBe(1);
    expect(
      (await listTasksForProject(project.key, F({ assigneeId: member.id }), sessionUser(owner)))
        .items[0]?.assignee?.id,
    ).toBe(member.id);
    const byQ = await listTasksForProject(project.key, F({ q: 'awesome' }), sessionUser(owner));
    expect(byQ.total).toBe(1);
    expect(byQ.items[0]?.title).toBe('Awesome Feature');
  });

  it('sort by every supported field including assignee.name', async () => {
    const owner = await makeUser();
    const aaa = await makeUser({ name: 'AAA' });
    const zzz = await makeUser({ name: 'ZZZ' });
    const project = await makeProject({ ownerId: owner.id });
    await addMember(project.id, aaa.id, 'CONTRIBUTOR');
    await addMember(project.id, zzz.id, 'CONTRIBUTOR');
    await prisma.task.createMany({
      data: [
        { projectId: project.id, number: 1, title: 'Banana', creatorId: owner.id, assigneeId: aaa.id },
        { projectId: project.id, number: 2, title: 'Apple',  creatorId: owner.id, assigneeId: zzz.id },
        { projectId: project.id, number: 3, title: 'Cherry', creatorId: owner.id },
      ],
    });
    expect(
      (await listTasksForProject(project.key, F({ sort: 'number', dir: 'asc' }), sessionUser(owner)))
        .items.map((t) => t.number),
    ).toEqual([1, 2, 3]);
    expect(
      (await listTasksForProject(project.key, F({ sort: 'number', dir: 'desc' }), sessionUser(owner)))
        .items.map((t) => t.number),
    ).toEqual([3, 2, 1]);
    expect(
      (await listTasksForProject(project.key, F({ sort: 'title', dir: 'asc' }), sessionUser(owner)))
        .items.map((t) => t.title),
    ).toEqual(['Apple', 'Banana', 'Cherry']);
    for (const sort of ['status', 'priority', 'estimateHours', 'dueDate'] as const) {
      const out = await listTasksForProject(
        project.key, F({ sort, dir: 'asc' }), sessionUser(owner),
      );
      expect(out.items).toHaveLength(3);
    }
    const byAssignee = await listTasksForProject(
      project.key, F({ sort: 'assignee', dir: 'asc' }), sessionUser(owner),
    );
    expect(byAssignee.items[0]?.assignee?.name).toBe('AAA');
    expect(byAssignee.items[1]?.assignee?.name).toBe('ZZZ');
  });

  it('VIEWER on project they don’t belong → 403; project not found; empty pageCount=1', async () => {
    const { owner, project } = await scaffold();
    const viewer = await makeUser({ role: 'VIEWER' });
    const admin = await makeUser({ role: 'ADMIN' });
    await expect(listTasksForProject(project.key, F(), sessionUser(viewer)))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
    await expect(listTasksForProject('XX', F(), sessionUser(admin)))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    const out = await listTasksForProject(project.key, F(), sessionUser(owner));
    expect(out.total).toBe(0);
    expect(out.pageCount).toBe(1);
  });
});

// ============================================================================
// listTasksForBoard
// ============================================================================
describe('listTasksForBoard', () => {
  it('returns only non-CANCELED; embeds project info; non-viewer → 403', async () => {
    const { owner, project } = await scaffold();
    const stranger = await makeUser({ role: 'MEMBER' });
    await makeTask({ projectId: project.id, creatorId: owner.id, status: 'TODO' });
    await makeTask({ projectId: project.id, creatorId: owner.id, status: 'DONE' });
    await makeTask({ projectId: project.id, creatorId: owner.id, status: 'CANCELED' });
    const out = await listTasksForBoard(project.key, {}, sessionUser(owner));
    expect(out.tasks).toHaveLength(2);
    expect(out.tasks.every((t) => t.status !== 'CANCELED')).toBe(true);
    expect(out.project.key).toBe(project.key);
    await expect(listTasksForBoard(project.key, {}, sessionUser(stranger)))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
  });

  it('onlyMine overrides assigneeId filter', async () => {
    const owner = await makeUser();
    const me = await makeUser();
    const other = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    await addMember(project.id, me.id, 'CONTRIBUTOR');
    await addMember(project.id, other.id, 'CONTRIBUTOR');
    await makeTask({ projectId: project.id, creatorId: owner.id, assigneeId: me.id });
    await makeTask({ projectId: project.id, creatorId: owner.id, assigneeId: other.id });
    const out = await listTasksForBoard(project.key, { onlyMine: true, assigneeId: other.id }, sessionUser(me));
    expect(out.tasks).toHaveLength(1);
    expect(out.tasks[0]?.assignee?.id).toBe(me.id);
  });

  it('filters compose: priority + q', async () => {
    const { owner, project } = await scaffold();
    const t1 = await makeTask({ projectId: project.id, creatorId: owner.id, title: 'urgent fix' });
    await prisma.task.update({ where: { id: t1.id }, data: { priority: 'URGENT' } });
    await makeTask({ projectId: project.id, creatorId: owner.id, title: 'urgent talk' });
    const t3 = await makeTask({ projectId: project.id, creatorId: owner.id, title: 'normal' });
    await prisma.task.update({ where: { id: t3.id }, data: { priority: 'URGENT' } });
    const out = await listTasksForBoard(project.key, { priority: 'URGENT', q: 'urgent' }, sessionUser(owner));
    expect(out.tasks).toHaveLength(1);
    expect(out.tasks[0]?.title).toBe('urgent fix');
  });
});

// ============================================================================
// listRecentTasksForProject
// ============================================================================
describe('listRecentTasksForProject', () => {
  it('returns up to limit, ordered by updatedAt desc', async () => {
    const { owner, project } = await scaffold();
    await makeTask({ projectId: project.id, creatorId: owner.id });
    await new Promise((r) => setTimeout(r, 5));
    const t2 = await makeTask({ projectId: project.id, creatorId: owner.id });
    await new Promise((r) => setTimeout(r, 5));
    const t3 = await makeTask({ projectId: project.id, creatorId: owner.id });
    const out = await listRecentTasksForProject(project.id, 2);
    expect(out).toHaveLength(2);
    expect(out[0]?.id).toBe(t3.id);
    expect(out[1]?.id).toBe(t2.id);
  });

  it('default limit is 5', async () => {
    const { owner, project } = await scaffold();
    for (let i = 0; i < 7; i++) {
      await makeTask({ projectId: project.id, creatorId: owner.id });
    }
    const out = await listRecentTasksForProject(project.id);
    expect(out).toHaveLength(5);
  });
});

// ============================================================================
// getTask
// ============================================================================
describe('getTask', () => {
  it('non-existent number → NOT_FOUND; wrong project key → NOT_FOUND', async () => {
    const { owner, project } = await scaffold();
    const admin = await makeUser({ role: 'ADMIN' });
    await expect(getTask(project.key, 999, sessionUser(owner)))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getTask('XX', 1, sessionUser(admin)))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('non-viewer → INSUFFICIENT_PERMISSIONS; PM can view any project task', async () => {
    const { owner, project } = await scaffold();
    const stranger = await makeUser({ role: 'MEMBER' });
    const pm = await makeUser({ role: 'PM' });
    const task = await makeTask({ projectId: project.id, creatorId: owner.id, number: 1 });
    await expect(getTask(project.key, task.number, sessionUser(stranger)))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
    const detail = await getTask(project.key, 1, sessionUser(pm));
    expect(detail.number).toBe(1);
  });

  it('includes comments + statusChanges sorted ascending', async () => {
    const { owner, project } = await scaffold();
    const task = await makeTask({ projectId: project.id, creatorId: owner.id, number: 1, status: 'BACKLOG' });
    await addComment(task.id, 'first', sessionUser(owner));
    await new Promise((r) => setTimeout(r, 5));
    await addComment(task.id, 'second', sessionUser(owner));
    await changeTaskStatus(task.id, 'TODO', sessionUser(owner));
    await new Promise((r) => setTimeout(r, 5));
    await changeTaskStatus(task.id, 'IN_PROGRESS', sessionUser(owner));
    const detail = await getTask(project.key, 1, sessionUser(owner));
    expect(detail.comments.map((c) => c.body)).toEqual(['first', 'second']);
    expect(detail.statusChanges.map((s) => s.toStatus)).toEqual(['TODO', 'IN_PROGRESS']);
  });
});
