import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import {
  getTodayTotals,
  listMyInProgress,
  listDueToday,
  listOverdue,
  getLast7Days,
} from '@/lib/dashboard';
import {
  makeUser,
  makeProject,
  makeTask,
} from './helpers/factories';

// Helpers ----------------------------------------------------------------

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function minutesAgo(min: number): Date {
  return new Date(Date.now() - min * 60_000);
}

function daysFromToday(days: number, hour = 12): Date {
  const d = startOfToday();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

async function createClosedEntry(opts: {
  userId: string;
  taskId: string | null;
  startedAt: Date;
  durationMin: number;
}) {
  const endedAt = new Date(opts.startedAt.getTime() + opts.durationMin * 60_000);
  return prisma.timeEntry.create({
    data: {
      userId: opts.userId,
      taskId: opts.taskId,
      startedAt: opts.startedAt,
      endedAt,
      durationMin: opts.durationMin,
      source: 'MANUAL_TIMER',
    },
  });
}

async function createActiveTimer(opts: {
  userId: string;
  taskId: string | null;
  startedAt: Date;
}) {
  return prisma.timeEntry.create({
    data: {
      userId: opts.userId,
      taskId: opts.taskId,
      startedAt: opts.startedAt,
      endedAt: null,
      durationMin: null,
      source: 'MANUAL_TIMER',
    },
  });
}

// =======================================================================
// getTodayTotals
// =======================================================================

describe('getTodayTotals', () => {
  it('returns totalMin=0 and empty perProject for an empty DB', async () => {
    const user = await makeUser();
    const result = await getTodayTotals(user.id);
    expect(result.totalMin).toBe(0);
    expect(result.perProject).toEqual([]);
  });

  it('sums 3 closed entries across 2 projects today and sorts perProject desc by minutes', async () => {
    const user = await makeUser();
    const projA = await makeProject({ ownerId: user.id, key: 'AAA', name: 'Alpha' });
    const projB = await makeProject({ ownerId: user.id, key: 'BBB', name: 'Bravo' });
    const taskA1 = await makeTask({ projectId: projA.id, creatorId: user.id, assigneeId: user.id });
    const taskA2 = await makeTask({ projectId: projA.id, creatorId: user.id, assigneeId: user.id });
    const taskB1 = await makeTask({ projectId: projB.id, creatorId: user.id, assigneeId: user.id });

    const todayNoon = startOfToday();
    todayNoon.setHours(10, 0, 0, 0);
    await createClosedEntry({ userId: user.id, taskId: taskA1.id, startedAt: todayNoon, durationMin: 60 });
    await createClosedEntry({ userId: user.id, taskId: taskA2.id, startedAt: new Date(todayNoon.getTime() + 3600_000), durationMin: 30 });
    await createClosedEntry({ userId: user.id, taskId: taskB1.id, startedAt: new Date(todayNoon.getTime() + 2 * 3600_000), durationMin: 90 });

    const result = await getTodayTotals(user.id);
    expect(result.totalMin).toBe(180);
    expect(result.perProject).toHaveLength(2);
    // Bravo has 90 minutes, Alpha has 60+30=90 minutes — sort by minutes desc, but tied
    // With tie, Bravo (90) and Alpha (90) — both have 90. Pick the one greater first deterministically.
    // Implementation just sorts desc by minutes; with tie either order may appear.
    const alpha = result.perProject.find((p) => p.key === 'AAA');
    const bravo = result.perProject.find((p) => p.key === 'BBB');
    expect(alpha?.minutes).toBe(90);
    expect(bravo?.minutes).toBe(90);
  });

  it('sorts perProject strictly desc when minutes differ', async () => {
    const user = await makeUser();
    const big = await makeProject({ ownerId: user.id, key: 'BIG', name: 'Big' });
    const small = await makeProject({ ownerId: user.id, key: 'SML', name: 'Small' });
    const tBig = await makeTask({ projectId: big.id, creatorId: user.id, assigneeId: user.id });
    const tSml = await makeTask({ projectId: small.id, creatorId: user.id, assigneeId: user.id });
    const start = startOfToday();
    start.setHours(9, 0, 0, 0);
    await createClosedEntry({ userId: user.id, taskId: tBig.id, startedAt: start, durationMin: 120 });
    await createClosedEntry({ userId: user.id, taskId: tSml.id, startedAt: start, durationMin: 30 });

    const result = await getTodayTotals(user.id);
    expect(result.totalMin).toBe(150);
    expect(result.perProject[0].key).toBe('BIG');
    expect(result.perProject[1].key).toBe('SML');
  });

  it('counts an active timer started 90 minutes ago as ~90 min (±2)', async () => {
    const user = await makeUser();
    const proj = await makeProject({ ownerId: user.id, key: 'LIV' });
    const task = await makeTask({ projectId: proj.id, creatorId: user.id, assigneeId: user.id });
    await createActiveTimer({ userId: user.id, taskId: task.id, startedAt: minutesAgo(90) });

    const result = await getTodayTotals(user.id);
    expect(result.totalMin).toBeGreaterThanOrEqual(88);
    expect(result.totalMin).toBeLessThanOrEqual(92);
    expect(result.perProject).toHaveLength(1);
    expect(result.perProject[0].minutes).toBeGreaterThanOrEqual(88);
  });

  it('does not count an entry from yesterday', async () => {
    const user = await makeUser();
    const proj = await makeProject({ ownerId: user.id, key: 'YES' });
    const task = await makeTask({ projectId: proj.id, creatorId: user.id, assigneeId: user.id });
    await createClosedEntry({ userId: user.id, taskId: task.id, startedAt: daysFromToday(-1), durationMin: 60 });

    const result = await getTodayTotals(user.id);
    expect(result.totalMin).toBe(0);
    expect(result.perProject).toEqual([]);
  });

  it('does not count an entry from tomorrow', async () => {
    const user = await makeUser();
    const proj = await makeProject({ ownerId: user.id, key: 'TMR' });
    const task = await makeTask({ projectId: proj.id, creatorId: user.id, assigneeId: user.id });
    await createClosedEntry({ userId: user.id, taskId: task.id, startedAt: daysFromToday(1), durationMin: 60 });

    const result = await getTodayTotals(user.id);
    expect(result.totalMin).toBe(0);
  });

  it('buckets entries without taskId under "Без проекта"', async () => {
    const user = await makeUser();
    const start = startOfToday();
    start.setHours(11, 0, 0, 0);
    await createClosedEntry({ userId: user.id, taskId: null, startedAt: start, durationMin: 45 });

    const result = await getTodayTotals(user.id);
    expect(result.totalMin).toBe(45);
    expect(result.perProject).toHaveLength(1);
    expect(result.perProject[0].name).toBe('Без проекта');
    expect(result.perProject[0].minutes).toBe(45);
  });

  it('does not include other users\' entries', async () => {
    const me = await makeUser();
    const other = await makeUser();
    const proj = await makeProject({ ownerId: other.id, key: 'OTH' });
    const task = await makeTask({ projectId: proj.id, creatorId: other.id, assigneeId: other.id });
    const start = startOfToday();
    start.setHours(10, 0, 0, 0);
    await createClosedEntry({ userId: other.id, taskId: task.id, startedAt: start, durationMin: 120 });

    const result = await getTodayTotals(me.id);
    expect(result.totalMin).toBe(0);
  });
});

// =======================================================================
// listMyInProgress
// =======================================================================

describe('listMyInProgress', () => {
  it('returns max 5 items', async () => {
    const user = await makeUser();
    const proj = await makeProject({ ownerId: user.id });
    for (let i = 0; i < 7; i++) {
      await makeTask({
        projectId: proj.id,
        creatorId: user.id,
        assigneeId: user.id,
        status: 'IN_PROGRESS',
      });
    }
    const result = await listMyInProgress(user.id);
    expect(result).toHaveLength(5);
  });

  it('orders IN_PROGRESS before REVIEW (status asc)', async () => {
    const user = await makeUser();
    const proj = await makeProject({ ownerId: user.id });
    const review = await makeTask({
      projectId: proj.id,
      creatorId: user.id,
      assigneeId: user.id,
      status: 'REVIEW',
    });
    const inProg = await makeTask({
      projectId: proj.id,
      creatorId: user.id,
      assigneeId: user.id,
      status: 'IN_PROGRESS',
    });
    const result = await listMyInProgress(user.id);
    // 'IN_PROGRESS' < 'REVIEW' alphabetically
    expect(result.map((t) => t.id)).toEqual([inProg.id, review.id]);
  });

  it('orders by updatedAt desc within same status', async () => {
    const user = await makeUser();
    const proj = await makeProject({ ownerId: user.id });
    const t1 = await makeTask({
      projectId: proj.id,
      creatorId: user.id,
      assigneeId: user.id,
      status: 'IN_PROGRESS',
    });
    // Sleep to guarantee distinct updatedAt
    await new Promise((r) => setTimeout(r, 10));
    const t2 = await makeTask({
      projectId: proj.id,
      creatorId: user.id,
      assigneeId: user.id,
      status: 'IN_PROGRESS',
    });
    await new Promise((r) => setTimeout(r, 10));
    // touch t1 so it becomes the most recent
    await prisma.task.update({ where: { id: t1.id }, data: { title: 'touched' } });
    const result = await listMyInProgress(user.id);
    expect(result.map((t) => t.id)).toEqual([t1.id, t2.id]);
  });

  it('returns only tasks where assigneeId === userId', async () => {
    const me = await makeUser();
    const other = await makeUser();
    const proj = await makeProject({ ownerId: me.id });
    const mine = await makeTask({
      projectId: proj.id,
      creatorId: me.id,
      assigneeId: me.id,
      status: 'IN_PROGRESS',
    });
    await makeTask({
      projectId: proj.id,
      creatorId: me.id,
      assigneeId: other.id,
      status: 'IN_PROGRESS',
    });
    const result = await listMyInProgress(me.id);
    expect(result.map((t) => t.id)).toEqual([mine.id]);
  });

  it('does not include tasks with statuses other than IN_PROGRESS / REVIEW', async () => {
    const user = await makeUser();
    const proj = await makeProject({ ownerId: user.id });
    for (const s of ['BACKLOG', 'TODO', 'BLOCKED', 'DONE', 'CANCELED'] as const) {
      await makeTask({ projectId: proj.id, creatorId: user.id, assigneeId: user.id, status: s });
    }
    const ip = await makeTask({
      projectId: proj.id,
      creatorId: user.id,
      assigneeId: user.id,
      status: 'IN_PROGRESS',
    });
    const result = await listMyInProgress(user.id);
    expect(result.map((t) => t.id)).toEqual([ip.id]);
  });

  it('returns empty list when no matching tasks', async () => {
    const user = await makeUser();
    const proj = await makeProject({ ownerId: user.id });
    await makeTask({ projectId: proj.id, creatorId: user.id, assigneeId: user.id, status: 'TODO' });
    const result = await listMyInProgress(user.id);
    expect(result).toEqual([]);
  });
});

// =======================================================================
// listDueToday
// =======================================================================

describe('listDueToday', () => {
  it('returns my tasks with dueDate today and active status', async () => {
    const user = await makeUser();
    const proj = await makeProject({ ownerId: user.id });
    const t = await makeTask({
      projectId: proj.id,
      creatorId: user.id,
      assigneeId: user.id,
      status: 'IN_PROGRESS',
    });
    await prisma.task.update({ where: { id: t.id }, data: { dueDate: daysFromToday(0) } });
    const result = await listDueToday(user.id);
    expect(result.map((x) => x.id)).toEqual([t.id]);
  });

  it('excludes DONE and CANCELED tasks even if due today', async () => {
    const user = await makeUser();
    const proj = await makeProject({ ownerId: user.id });
    for (const s of ['DONE', 'CANCELED'] as const) {
      const t = await makeTask({
        projectId: proj.id,
        creatorId: user.id,
        assigneeId: user.id,
        status: s,
      });
      await prisma.task.update({ where: { id: t.id }, data: { dueDate: daysFromToday(0) } });
    }
    const result = await listDueToday(user.id);
    expect(result).toEqual([]);
  });

  it('does not include other users\' due-today tasks', async () => {
    const me = await makeUser();
    const other = await makeUser();
    const proj = await makeProject({ ownerId: me.id });
    const t = await makeTask({
      projectId: proj.id,
      creatorId: me.id,
      assigneeId: other.id,
      status: 'TODO',
    });
    await prisma.task.update({ where: { id: t.id }, data: { dueDate: daysFromToday(0) } });
    const result = await listDueToday(me.id);
    expect(result).toEqual([]);
  });

  it('does not include tomorrow\'s tasks', async () => {
    const user = await makeUser();
    const proj = await makeProject({ ownerId: user.id });
    const t = await makeTask({
      projectId: proj.id,
      creatorId: user.id,
      assigneeId: user.id,
      status: 'TODO',
    });
    await prisma.task.update({ where: { id: t.id }, data: { dueDate: daysFromToday(1) } });
    const result = await listDueToday(user.id);
    expect(result).toEqual([]);
  });

  it('does not include yesterday\'s tasks (those are overdue)', async () => {
    const user = await makeUser();
    const proj = await makeProject({ ownerId: user.id });
    const t = await makeTask({
      projectId: proj.id,
      creatorId: user.id,
      assigneeId: user.id,
      status: 'TODO',
    });
    await prisma.task.update({ where: { id: t.id }, data: { dueDate: daysFromToday(-1) } });
    const result = await listDueToday(user.id);
    expect(result).toEqual([]);
  });
});

// =======================================================================
// listOverdue
// =======================================================================

describe('listOverdue', () => {
  it('returns my tasks with dueDate strictly before today', async () => {
    const user = await makeUser();
    const proj = await makeProject({ ownerId: user.id });
    const t = await makeTask({
      projectId: proj.id,
      creatorId: user.id,
      assigneeId: user.id,
      status: 'TODO',
    });
    await prisma.task.update({ where: { id: t.id }, data: { dueDate: daysFromToday(-2) } });
    const result = await listOverdue(user.id);
    expect(result.map((x) => x.id)).toEqual([t.id]);
  });

  it('does NOT include tasks with dueDate equal to today', async () => {
    const user = await makeUser();
    const proj = await makeProject({ ownerId: user.id });
    const t = await makeTask({
      projectId: proj.id,
      creatorId: user.id,
      assigneeId: user.id,
      status: 'TODO',
    });
    // dueDate at start of today — start of today is NOT strictly before start of today
    await prisma.task.update({
      where: { id: t.id },
      data: { dueDate: startOfToday() },
    });
    const result = await listOverdue(user.id);
    expect(result).toEqual([]);
  });

  it('excludes DONE and CANCELED', async () => {
    const user = await makeUser();
    const proj = await makeProject({ ownerId: user.id });
    for (const s of ['DONE', 'CANCELED'] as const) {
      const t = await makeTask({
        projectId: proj.id,
        creatorId: user.id,
        assigneeId: user.id,
        status: s,
      });
      await prisma.task.update({ where: { id: t.id }, data: { dueDate: daysFromToday(-3) } });
    }
    const result = await listOverdue(user.id);
    expect(result).toEqual([]);
  });

  it('does not include other users\' overdue tasks', async () => {
    const me = await makeUser();
    const other = await makeUser();
    const proj = await makeProject({ ownerId: me.id });
    const t = await makeTask({
      projectId: proj.id,
      creatorId: me.id,
      assigneeId: other.id,
      status: 'TODO',
    });
    await prisma.task.update({ where: { id: t.id }, data: { dueDate: daysFromToday(-2) } });
    const result = await listOverdue(me.id);
    expect(result).toEqual([]);
  });
});

// =======================================================================
// getLast7Days
// =======================================================================

describe('getLast7Days', () => {
  it('returns exactly 7 buckets covering today and 6 prior days', async () => {
    const user = await makeUser();
    const result = await getLast7Days(user.id);
    expect(result).toHaveLength(7);

    const today = startOfToday();
    const expectedKeys: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      expectedKeys.push(key);
    }
    expect(result.map((b) => b.dayKey)).toEqual(expectedKeys);
  });

  it('emits Russian short weekday + day-number labels', async () => {
    const user = await makeUser();
    const result = await getLast7Days(user.id);
    // Implementation uses Intl.DateTimeFormat('ru-RU', {weekday:'short',day:'2-digit'})
    // which produces strings like "пн, 04" — assert format shape, not exact case.
    for (const b of result) {
      // Lower or upper-case Cyrillic + 2-digit day
      expect(b.label).toMatch(/[А-Яа-я]{2,3}[,.\s]+\d{2}/);
    }
  });

  it('credits closed entries to their respective days', async () => {
    const user = await makeUser();
    const proj = await makeProject({ ownerId: user.id });
    const task = await makeTask({ projectId: proj.id, creatorId: user.id, assigneeId: user.id });

    await createClosedEntry({ userId: user.id, taskId: task.id, startedAt: daysFromToday(-3, 10), durationMin: 45 });
    await createClosedEntry({ userId: user.id, taskId: task.id, startedAt: daysFromToday(0, 10), durationMin: 25 });

    const result = await getLast7Days(user.id);
    const today = startOfToday();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const minus3 = new Date(today);
    minus3.setDate(today.getDate() - 3);
    const minus3Key = `${minus3.getFullYear()}-${String(minus3.getMonth() + 1).padStart(2, '0')}-${String(minus3.getDate()).padStart(2, '0')}`;

    const todayBucket = result.find((b) => b.dayKey === todayKey);
    const minus3Bucket = result.find((b) => b.dayKey === minus3Key);
    expect(todayBucket?.minutes).toBe(25);
    expect(minus3Bucket?.minutes).toBe(45);
  });

  it('credits an active timer (now - startedAt) into today\'s bucket', async () => {
    const user = await makeUser();
    const proj = await makeProject({ ownerId: user.id });
    const task = await makeTask({ projectId: proj.id, creatorId: user.id, assigneeId: user.id });
    await createActiveTimer({ userId: user.id, taskId: task.id, startedAt: minutesAgo(30) });

    const result = await getLast7Days(user.id);
    const today = startOfToday();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const todayBucket = result.find((b) => b.dayKey === todayKey)!;
    expect(todayBucket.minutes).toBeGreaterThanOrEqual(28);
    expect(todayBucket.minutes).toBeLessThanOrEqual(32);
  });

  it('excludes entries older than 7 days', async () => {
    const user = await makeUser();
    const proj = await makeProject({ ownerId: user.id });
    const task = await makeTask({ projectId: proj.id, creatorId: user.id, assigneeId: user.id });
    await createClosedEntry({ userId: user.id, taskId: task.id, startedAt: daysFromToday(-8, 10), durationMin: 60 });
    await createClosedEntry({ userId: user.id, taskId: task.id, startedAt: daysFromToday(-30, 10), durationMin: 60 });

    const result = await getLast7Days(user.id);
    const total = result.reduce((s, b) => s + b.minutes, 0);
    expect(total).toBe(0);
  });

  it('boundary: an entry started 23:55 yesterday-local-time lands in yesterday\'s bucket, not today', async () => {
    const user = await makeUser();
    const proj = await makeProject({ ownerId: user.id });
    const task = await makeTask({ projectId: proj.id, creatorId: user.id, assigneeId: user.id });
    // 23:55 yesterday in server-local time
    const yesterday = startOfToday();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(23, 55, 0, 0);
    await createClosedEntry({ userId: user.id, taskId: task.id, startedAt: yesterday, durationMin: 3 });

    const result = await getLast7Days(user.id);
    const today = startOfToday();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const yKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    const todayBucket = result.find((b) => b.dayKey === todayKey)!;
    const yBucket = result.find((b) => b.dayKey === yKey)!;
    expect(yBucket.minutes).toBe(3);
    expect(todayBucket.minutes).toBe(0);
  });

  it('returns 7 zero-minute buckets when no entries exist', async () => {
    const user = await makeUser();
    const result = await getLast7Days(user.id);
    expect(result).toHaveLength(7);
    expect(result.every((b) => b.minutes === 0)).toBe(true);
  });
});
