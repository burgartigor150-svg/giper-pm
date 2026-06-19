import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Integration tests for the daily sprint-snapshot writer at
 * /api/cron/sprint-snapshot. It records remaining work per ACTIVE sprint so the
 * burndown can show a real per-day history; getting the upsert key wrong would
 * duplicate rows or never update.
 *
 * Source: apps/web/app/api/cron/sprint-snapshot/route.ts
 */

import { prisma } from '@giper/db';
import { POST } from '@/app/api/cron/sprint-snapshot/route';
import { getSprintBurndown } from '@/lib/sprints/getSprintBurndown';
import { makeProject, makeTask, makeUser } from './helpers/factories';

const SECRET = 'test-cron-secret';

function cronReq(auth: string | null = `Bearer ${SECRET}`): Request {
  return new Request('http://test.local/api/cron/sprint-snapshot', {
    method: 'POST',
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
});

async function activeSprintWithTasks(ownerId: string, projectId: string) {
  const sprint = await prisma.sprint.create({
    data: { projectId, name: 'S1', status: 'ACTIVE', createdById: ownerId },
  });
  // 3 tasks, 5 points each (15 total); one DONE (10 remaining).
  const t1 = await makeTask({ projectId, creatorId: ownerId, status: 'IN_PROGRESS' });
  const t2 = await makeTask({ projectId, creatorId: ownerId, status: 'TODO' });
  const t3 = await makeTask({ projectId, creatorId: ownerId, status: 'DONE' });
  for (const t of [t1, t2, t3]) {
    await prisma.task.update({
      where: { id: t.id },
      data: { sprintId: sprint.id, storyPoints: 5, internalStatus: t === t3 ? 'DONE' : t1 === t ? 'IN_PROGRESS' : 'TODO' },
    });
  }
  return sprint;
}

describe('cron /api/cron/sprint-snapshot', () => {
  it('rejects without the Bearer secret', async () => {
    const res = await POST(cronReq(null));
    expect(res.status).toBe(401);
  });

  it('writes one snapshot per active sprint with correct remaining', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const sprint = await activeSprintWithTasks(owner.id, project.id);

    const res = await POST(cronReq());
    expect(res.status).toBe(200);

    const snaps = await prisma.sprintSnapshot.findMany({ where: { sprintId: sprint.id } });
    expect(snaps).toHaveLength(1);
    expect(snaps[0]?.totalPoints).toBe(15);
    expect(snaps[0]?.remainingPoints).toBe(10); // 1 of 3 done
    expect(snaps[0]?.totalTasks).toBe(3);
    expect(snaps[0]?.remainingTasks).toBe(2);
  });

  it('is idempotent for the same day (upsert, not duplicate)', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const sprint = await activeSprintWithTasks(owner.id, project.id);

    await POST(cronReq());
    await POST(cronReq());
    const snaps = await prisma.sprintSnapshot.findMany({ where: { sprintId: sprint.id } });
    expect(snaps).toHaveLength(1);
  });

  it('does not snapshot non-ACTIVE sprints', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const planned = await prisma.sprint.create({
      data: { projectId: project.id, name: 'Planned', status: 'PLANNED', createdById: owner.id },
    });
    await POST(cronReq());
    const snaps = await prisma.sprintSnapshot.findMany({ where: { sprintId: planned.id } });
    expect(snaps).toHaveLength(0);
  });

  it('getSprintBurndown surfaces the snapshot history', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const sprint = await activeSprintWithTasks(owner.id, project.id);
    await POST(cronReq());

    const data = await getSprintBurndown(sprint.id);
    expect(data).not.toBeNull();
    expect(data!.history).toHaveLength(1);
    expect(data!.history[0]?.remaining).toBe(10); // points (usePoints = true)
  });
});
