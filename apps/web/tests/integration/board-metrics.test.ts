import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import { getBoardMetrics } from '@/lib/board/getBoardMetrics';
import { makeProject, makeTask, makeUser } from './helpers/factories';

describe('getBoardMetrics', () => {
  it('WIP excludes DONE and CANCELED (only in-flight columns)', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const inProg = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      status: 'IN_PROGRESS',
    });
    const done = await makeTask({ projectId: project.id, creatorId: owner.id, status: 'DONE' });
    const canceled = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      status: 'CANCELED',
    });
    // The board buckets by internalStatus; makeTask sets `status` only.
    await prisma.task.update({
      where: { id: inProg.id },
      data: { internalStatus: 'IN_PROGRESS' },
    });
    await prisma.task.update({
      where: { id: done.id },
      data: { internalStatus: 'DONE', completedAt: new Date() },
    });
    await prisma.task.update({
      where: { id: canceled.id },
      data: { internalStatus: 'CANCELED' },
    });

    const m = await getBoardMetrics(project.id, Date.now());
    const wipStatuses = m.wip.map((w) => w.status);
    expect(wipStatuses).toContain('IN_PROGRESS');
    expect(wipStatuses).not.toContain('DONE');
    expect(wipStatuses).not.toContain('CANCELED');
  });
});
