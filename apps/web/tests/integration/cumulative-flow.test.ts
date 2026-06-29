import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Cumulative-flow diagram: the daily status-snapshot cron + the read/shape
 * helper. The cron records per-project per-status card counts for today; the
 * helper stacks the last N days into flow bands (CANCELED excluded, missing=0).
 * Source: app/api/cron/status-snapshot/route.ts, lib/board/getCumulativeFlow.ts.
 */

import { prisma } from '@giper/db';
import { POST } from '@/app/api/cron/status-snapshot/route';
import { getCumulativeFlow } from '@/lib/board/getCumulativeFlow';
import { makeProject, makeTask, makeUser } from './helpers/factories';

const SECRET = 'test-cron-secret';
const cronReq = (auth: string | null = `Bearer ${SECRET}`) =>
  new Request('http://test.local/api/cron/status-snapshot', {
    method: 'POST',
    headers: auth ? { authorization: auth } : {},
  });

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
});

const today = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
};

describe('cron /api/cron/status-snapshot', () => {
  it('rejects without the Bearer secret', async () => {
    const res = await POST(cronReq(null));
    expect(res.status).toBe(401);
  });

  it('writes per-project per-status counts for today (idempotent on re-run)', async () => {
    const owner = await makeUser();
    const p = await makeProject({ ownerId: owner.id });
    // 2 IN_PROGRESS, 1 DONE, 1 TODO.
    for (const s of ['IN_PROGRESS', 'IN_PROGRESS', 'DONE', 'TODO'] as const) {
      await makeTask({ projectId: p.id, creatorId: owner.id, internalStatus: s });
    }

    expect((await POST(cronReq())).status).toBe(200);
    const rows = await prisma.statusSnapshot.findMany({
      where: { projectId: p.id, date: today() },
    });
    const byStatus = new Map(rows.map((r) => [r.status, r.count]));
    expect(byStatus.get('IN_PROGRESS')).toBe(2);
    expect(byStatus.get('DONE')).toBe(1);
    expect(byStatus.get('TODO')).toBe(1);

    // Re-run after a status change → today's row is overwritten, not duplicated.
    const one = await prisma.task.findFirstOrThrow({ where: { projectId: p.id, internalStatus: 'TODO' } });
    await prisma.task.update({ where: { id: one.id }, data: { internalStatus: 'IN_PROGRESS' } });
    expect((await POST(cronReq())).status).toBe(200);
    const after = await prisma.statusSnapshot.findMany({ where: { projectId: p.id, date: today() } });
    const m2 = new Map(after.map((r) => [r.status, r.count]));
    expect(m2.get('IN_PROGRESS')).toBe(3);
    expect(m2.has('TODO')).toBe(false); // no TODO cards left → no row
    // No duplicate rows for any status.
    expect(after.length).toBe(new Set(after.map((r) => r.status)).size);
  });
});

describe('getCumulativeFlow', () => {
  it('shapes snapshots into stacked bands, excludes CANCELED, fills gaps with 0', async () => {
    const owner = await makeUser();
    const p = await makeProject({ ownerId: owner.id });
    const d1 = new Date(Date.UTC(2026, 5, 1));
    const d2 = new Date(Date.UTC(2026, 5, 2));
    await prisma.statusSnapshot.createMany({
      data: [
        { projectId: p.id, date: d1, status: 'TODO', count: 5 },
        { projectId: p.id, date: d1, status: 'DONE', count: 1 },
        { projectId: p.id, date: d1, status: 'CANCELED', count: 9 }, // must be excluded
        { projectId: p.id, date: d2, status: 'IN_PROGRESS', count: 2 },
        { projectId: p.id, date: d2, status: 'DONE', count: 3 },
      ],
    });

    const cfd = await getCumulativeFlow(p.id, 3650); // wide window to include 2026 dates
    expect(cfd.dates).toEqual(['2026-06-01', '2026-06-02']);
    const done = cfd.series.find((s) => s.status === 'DONE');
    const todo = cfd.series.find((s) => s.status === 'TODO');
    const inprog = cfd.series.find((s) => s.status === 'IN_PROGRESS');
    expect(done?.counts).toEqual([1, 3]);
    expect(todo?.counts).toEqual([5, 0]); // gap on d2 → 0
    expect(inprog?.counts).toEqual([0, 2]); // gap on d1 → 0
    // CANCELED is not a band.
    expect(cfd.series.some((s) => s.status === 'CANCELED')).toBe(false);
  });

  it('returns empty series when there are no snapshots', async () => {
    const owner = await makeUser();
    const p = await makeProject({ ownerId: owner.id });
    const cfd = await getCumulativeFlow(p.id, 30);
    expect(cfd.dates).toEqual([]);
  });
});
