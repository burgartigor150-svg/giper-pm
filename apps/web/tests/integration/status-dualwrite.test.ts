import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import { statusSeedId } from '@giper/shared';
import { createProject } from '@/lib/projects/createProject';
import { createTask } from '@/lib/tasks/createTask';
import { setInternalStatus } from '@/lib/tasks/setInternalStatus';
import {
  materializeProjectColumns,
  backfillAllStatuses,
  seedProjectStatuses,
} from '@/lib/status/backfillStatuses';
import { makeUser, makeProject, makeTask, sessionUser } from './helpers/factories';

/**
 * S2 — every task write keeps the shadow FKs (statusId / internalStatusId /
 * columnId) in step with the legacy enum, so S3 can flip the board onto them.
 * The board still reads the enum here — these only assert the new tracks.
 */
describe('status dual-write (S2)', () => {
  it('createProject seeds 7 statuses + materializes 6 board columns', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    const project = await createProject({ name: 'S2 Alpha', key: 'S2A' }, sessionUser(owner));

    expect(await prisma.status.count({ where: { projectId: project.id } })).toBe(7);
    const cols = await prisma.boardColumn.findMany({ where: { projectId: project.id }, orderBy: { order: 'asc' } });
    expect(cols.map((c) => c.status)).toEqual(['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'BLOCKED', 'DONE']);
    // Each column links its seeded Status.
    expect(cols[2]!.statusId).toBe(statusSeedId(project.id, 'IN_PROGRESS'));
  });

  it('createTask stamps the BACKLOG status + column FKs', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    const project = await createProject({ name: 'S2 Beta', key: 'S2B' }, sessionUser(owner));

    const created = await createTask({ projectKey: project.key, title: 'Новая', tags: [] }, sessionUser(owner));
    const t = await prisma.task.findUniqueOrThrow({ where: { id: created.id } });
    expect(t.statusId).toBe(statusSeedId(project.id, 'BACKLOG'));
    expect(t.internalStatusId).toBe(statusSeedId(project.id, 'BACKLOG'));
    // columnId points at the project's BACKLOG column.
    const col = await prisma.boardColumn.findUniqueOrThrow({ where: { id: t.columnId! } });
    expect(col.status).toBe('BACKLOG');
  });

  it('setInternalStatus moves the internal FKs + columnId in step (invariant holds)', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    const project = await createProject({ name: 'S2 Gamma', key: 'S2G' }, sessionUser(owner));
    const task = await makeTask({ projectId: project.id, creatorId: owner.id, internalStatus: 'BACKLOG' });

    await setInternalStatus(task.id, 'IN_PROGRESS', sessionUser(owner));

    const t = await prisma.task.findUniqueOrThrow({ where: { id: task.id }, include: { column: true } });
    expect(t.internalStatus).toBe('IN_PROGRESS');
    expect(t.internalStatusId).toBe(statusSeedId(project.id, 'IN_PROGRESS'));
    // The load-bearing invariant: the placement column's status matches the task.
    expect(t.column?.status).toBe('IN_PROGRESS');
  });

  it('materializeProjectColumns is idempotent (6 columns, no dup on re-run)', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id }); // raw — no columns
    expect(await prisma.boardColumn.count({ where: { projectId: project.id } })).toBe(0);

    await materializeProjectColumns(prisma, project.id);
    await materializeProjectColumns(prisma, project.id);
    expect(await prisma.boardColumn.count({ where: { projectId: project.id } })).toBe(6);
  });

  it('backfillAllStatuses places existing tasks onto columnId (M5)', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    await seedProjectStatuses(prisma, project.id);
    const task = await makeTask({ projectId: project.id, creatorId: owner.id, internalStatus: 'REVIEW' });

    await backfillAllStatuses(prisma);

    const t = await prisma.task.findUniqueOrThrow({ where: { id: task.id }, include: { column: true } });
    expect(t.internalStatusId).toBe(statusSeedId(project.id, 'REVIEW'));
    expect(t.column?.status).toBe('REVIEW');
  });
});
