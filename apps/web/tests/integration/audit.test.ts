import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import { auditTask } from '@/lib/audit';
import { makeUser, makeProject, makeTask } from './helpers/factories';

async function setupTask() {
  const owner = await makeUser();
  const project = await makeProject({ ownerId: owner.id });
  const task = await makeTask({
    projectId: project.id,
    creatorId: owner.id,
    title: 'Test',
    number: 1,
  });
  return { owner, project, task };
}

describe('auditTask — task.create', () => {
  it('writes a row with after=task.number+title only', async () => {
    const { owner, task } = await setupTask();
    await auditTask({
      action: 'task.create',
      taskId: task.id,
      after: { number: task.number, title: task.title },
      userId: owner.id,
    });
    const rows = await prisma.auditLog.findMany({
      where: { entity: 'Task', entityId: task.id, action: 'task.create' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(owner.id);
    expect(rows[0]!.diff).toEqual({
      before: null,
      after: { number: task.number, title: task.title },
    });
  });
});

describe('auditTask — task.update', () => {
  it('writes diff with only changed keys', async () => {
    const { owner, task } = await setupTask();
    await auditTask({
      action: 'task.update',
      taskId: task.id,
      before: { title: 'Old', priority: 'LOW' },
      after: { title: 'New', priority: 'LOW' },
      userId: owner.id,
    });
    const rows = await prisma.auditLog.findMany({
      where: { entity: 'Task', entityId: task.id, action: 'task.update' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.diff).toEqual({
      title: { from: 'Old', to: 'New' },
    });
  });

  it('description body is redacted as <changed>', async () => {
    const { owner, task } = await setupTask();
    await auditTask({
      action: 'task.update',
      taskId: task.id,
      before: { description: 'secret old plaintext' },
      after: { description: 'secret new plaintext' },
      userId: owner.id,
    });
    const row = await prisma.auditLog.findFirstOrThrow({
      where: { entity: 'Task', entityId: task.id, action: 'task.update' },
    });
    expect(row.diff).toEqual({
      description: { from: '<changed>', to: '<changed>' },
    });
    // Sanity: the raw plaintext does not appear anywhere in the JSON.
    expect(JSON.stringify(row.diff)).not.toContain('secret old plaintext');
    expect(JSON.stringify(row.diff)).not.toContain('secret new plaintext');
  });

  it('no actual changes → does NOT write a row', async () => {
    const { owner, task } = await setupTask();
    await auditTask({
      action: 'task.update',
      taskId: task.id,
      before: { title: 'Same', priority: 'LOW' },
      after: { title: 'Same', priority: 'LOW' },
      userId: owner.id,
    });
    const rows = await prisma.auditLog.findMany({
      where: { entity: 'Task', entityId: task.id },
    });
    expect(rows).toHaveLength(0);
  });

  it('multiple changed keys all included', async () => {
    const { owner, task } = await setupTask();
    await auditTask({
      action: 'task.update',
      taskId: task.id,
      before: { title: 'A', priority: 'LOW', dueDate: null },
      after: { title: 'B', priority: 'HIGH', dueDate: null },
      userId: owner.id,
    });
    const row = await prisma.auditLog.findFirstOrThrow({
      where: { entity: 'Task', entityId: task.id, action: 'task.update' },
    });
    expect(row.diff).toEqual({
      title: { from: 'A', to: 'B' },
      priority: { from: 'LOW', to: 'HIGH' },
    });
  });

  it('description redacted while non-description changes recorded normally', async () => {
    const { owner, task } = await setupTask();
    await auditTask({
      action: 'task.update',
      taskId: task.id,
      before: { title: 'A', description: 'old body' },
      after: { title: 'B', description: 'new body' },
      userId: owner.id,
    });
    const row = await prisma.auditLog.findFirstOrThrow({
      where: { entity: 'Task', entityId: task.id, action: 'task.update' },
    });
    expect(row.diff).toEqual({
      title: { from: 'A', to: 'B' },
      description: { from: '<changed>', to: '<changed>' },
    });
  });
});

describe('auditTask — task.status_change', () => {
  it('uses {before, after} shape', async () => {
    const { owner, task } = await setupTask();
    await auditTask({
      action: 'task.status_change',
      taskId: task.id,
      before: { status: 'TODO' },
      after: { status: 'IN_PROGRESS' },
      userId: owner.id,
    });
    const row = await prisma.auditLog.findFirstOrThrow({
      where: { entity: 'Task', entityId: task.id, action: 'task.status_change' },
    });
    expect(row.diff).toEqual({
      before: { status: 'TODO' },
      after: { status: 'IN_PROGRESS' },
    });
  });
});

describe('auditTask — task.assign', () => {
  it('uses {before, after} shape', async () => {
    const { owner, task } = await setupTask();
    const newAssignee = await makeUser();
    await auditTask({
      action: 'task.assign',
      taskId: task.id,
      before: { assigneeId: null },
      after: { assigneeId: newAssignee.id },
      userId: owner.id,
    });
    const row = await prisma.auditLog.findFirstOrThrow({
      where: { entity: 'Task', entityId: task.id, action: 'task.assign' },
    });
    expect(row.diff).toEqual({
      before: { assigneeId: null },
      after: { assigneeId: newAssignee.id },
    });
  });
});

describe('auditTask — task.delete', () => {
  it('writes audit BEFORE the task is deleted (audit row remains after task is gone)', async () => {
    const { owner, task } = await setupTask();
    await auditTask({
      action: 'task.delete',
      taskId: task.id,
      before: { number: task.number, title: task.title },
      userId: owner.id,
    });
    // Now delete the task (typical caller flow audits-then-deletes).
    await prisma.task.delete({ where: { id: task.id } });

    const stillThere = await prisma.task.findUnique({ where: { id: task.id } });
    expect(stillThere).toBeNull();

    const auditRow = await prisma.auditLog.findFirstOrThrow({
      where: { entity: 'Task', entityId: task.id, action: 'task.delete' },
    });
    expect(auditRow.diff).toEqual({
      before: { number: task.number, title: task.title },
      after: null,
    });
  });
});
