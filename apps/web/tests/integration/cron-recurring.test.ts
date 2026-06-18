import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Integration tests for the recurring-card scanner at /api/cron/recurring.
 * The scanner materializes due RecurringTask rows into real cards and
 * advances their nextRunAt — getting the advance/idempotency wrong would
 * spawn duplicate cards or a backlog storm on prod.
 *
 * Source: apps/web/app/api/cron/recurring/route.ts
 */

import { prisma } from '@giper/db';
import { POST } from '@/app/api/cron/recurring/route';
import { makeUser, makeProject } from './helpers/factories';

const SECRET = 'test-cron-secret';

function cronReq(auth = `Bearer ${SECRET}`): Request {
  return new Request('http://test.local/api/cron/recurring', {
    method: 'POST',
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
});

async function makeRecurring(overrides: {
  ownerId: string;
  projectId: string;
  nextRunAt: Date;
  intervalDays?: number;
  active?: boolean;
  title?: string;
}) {
  return prisma.recurringTask.create({
    data: {
      projectId: overrides.projectId,
      title: overrides.title ?? 'Еженедельный отчёт',
      intervalDays: overrides.intervalDays ?? 7,
      nextRunAt: overrides.nextRunAt,
      active: overrides.active ?? true,
      createdById: overrides.ownerId,
    },
  });
}

describe('cron/recurring — auth', () => {
  it('rejects a missing/wrong secret with 401', async () => {
    const res = await POST(cronReq(''));
    expect(res.status).toBe(401);
  });
});

describe('cron/recurring — materialization', () => {
  it('creates a card for a due rule and advances nextRunAt', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const past = new Date(Date.now() - 2 * 24 * 3600_000); // 2 days ago
    const rec = await makeRecurring({
      ownerId: owner.id,
      projectId: project.id,
      nextRunAt: past,
      intervalDays: 7,
      title: 'Авто-карточка',
    });

    const res = await POST(cronReq());
    expect(res.status).toBe(200);

    const created = await prisma.task.findMany({
      where: { projectId: project.id, title: 'Авто-карточка' },
    });
    expect(created).toHaveLength(1);

    const after = await prisma.recurringTask.findUniqueOrThrow({ where: { id: rec.id } });
    expect(after.lastRunAt).not.toBeNull();
    // nextRunAt must have jumped into the future.
    expect(after.nextRunAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('does not create a card for a rule whose nextRunAt is in the future', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const future = new Date(Date.now() + 5 * 24 * 3600_000);
    await makeRecurring({ ownerId: owner.id, projectId: project.id, nextRunAt: future, title: 'Будущее' });

    await POST(cronReq());

    const created = await prisma.task.count({
      where: { projectId: project.id, title: 'Будущее' },
    });
    expect(created).toBe(0);
  });

  it('is idempotent: a second run in the same window creates nothing new', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const past = new Date(Date.now() - 24 * 3600_000);
    await makeRecurring({ ownerId: owner.id, projectId: project.id, nextRunAt: past, title: 'Раз в день', intervalDays: 1 });

    await POST(cronReq());
    await POST(cronReq());

    const created = await prisma.task.count({
      where: { projectId: project.id, title: 'Раз в день' },
    });
    expect(created).toBe(1);
  });

  it('skips inactive rules', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const past = new Date(Date.now() - 24 * 3600_000);
    await makeRecurring({ ownerId: owner.id, projectId: project.id, nextRunAt: past, active: false, title: 'Выключено' });

    await POST(cronReq());

    const created = await prisma.task.count({
      where: { projectId: project.id, title: 'Выключено' },
    });
    expect(created).toBe(0);
  });
});
