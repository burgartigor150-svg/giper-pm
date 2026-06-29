import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import {
  backfillAllStatuses,
  seedProjectStatuses,
  statusSeedId,
} from '@/lib/status/backfillStatuses';
import { defaultStatusForCategory } from '@/lib/status/category';
import { makeUser, makeProject } from './helpers/factories';

/**
 * S1 (expand, inert): the dynamic Status table is seeded per project and Task /
 * BoardColumn FKs are backfilled from the legacy enum tracks. Nothing reads
 * these yet — these tests pin the migration's data shape (the canonical SQL
 * lives in the prod migration; this exercises the TS mirror CI/dev use).
 */
describe('status backfill (S1)', () => {
  it('seeds 8 statuses per project and backfills Task/BoardColumn FKs from the enum', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const t1 = await prisma.task.create({
      data: { projectId: project.id, number: 1, title: 'A', creatorId: owner.id, status: 'IN_PROGRESS', internalStatus: 'REVIEW' },
    });
    const t2 = await prisma.task.create({
      data: { projectId: project.id, number: 2, title: 'B', creatorId: owner.id, status: 'DONE', internalStatus: 'DONE' },
    });
    const col = await prisma.boardColumn.create({
      data: { projectId: project.id, name: 'В работе', status: 'IN_PROGRESS', order: 0 },
    });

    await backfillAllStatuses(prisma);

    const statuses = await prisma.status.findMany({ where: { projectId: project.id }, orderBy: { order: 'asc' } });
    expect(statuses).toHaveLength(8);
    expect(statuses.map((s) => s.category)).toEqual([
      'BACKLOG', 'TODO', 'IN_PROGRESS', 'TESTING', 'REVIEW', 'BLOCKED', 'DONE', 'CANCELED',
    ]);
    expect(statuses.every((s) => s.isDefault)).toBe(true);

    // Task FKs match the deterministic seed id of each track (mirror + internal).
    const a = await prisma.task.findUniqueOrThrow({ where: { id: t1.id } });
    expect(a.statusId).toBe(statusSeedId(project.id, 'IN_PROGRESS'));
    expect(a.internalStatusId).toBe(statusSeedId(project.id, 'REVIEW'));
    const b = await prisma.task.findUniqueOrThrow({ where: { id: t2.id } });
    expect(b.statusId).toBe(statusSeedId(project.id, 'DONE'));

    // BoardColumn FK.
    const c = await prisma.boardColumn.findUniqueOrThrow({ where: { id: col.id } });
    expect(c.statusId).toBe(statusSeedId(project.id, 'IN_PROGRESS'));

    // The FK resolves to a real Status of the right category (relation works).
    const internal = await prisma.status.findUniqueOrThrow({ where: { id: a.internalStatusId! } });
    expect(internal.category).toBe('REVIEW');
  });

  it('is idempotent — re-running does not duplicate statuses or change FKs', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const t = await prisma.task.create({
      data: { projectId: project.id, number: 1, title: 'A', creatorId: owner.id, status: 'TODO', internalStatus: 'TODO' },
    });

    await backfillAllStatuses(prisma);
    await backfillAllStatuses(prisma);

    expect(await prisma.status.count({ where: { projectId: project.id } })).toBe(8);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.statusId).toBe(statusSeedId(project.id, 'TODO'));
  });

  it('defaultStatusForCategory resolves the seeded default', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    await seedProjectStatuses(prisma, project.id);
    const d = await defaultStatusForCategory(prisma, project.id, 'DONE');
    expect(d.id).toBe(statusSeedId(project.id, 'DONE'));
  });
});
