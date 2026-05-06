import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import {
  deleteTimeEntry,
  editTimeEntry,
  getActiveTimer,
  getTimeEntry,
  hasOverlappingEntry,
  listTimeEntries,
  logTimeManually,
  resolveRange,
  startTimer,
  stopTimer,
} from '@/lib/time';
import {
  addMember,
  makeProject,
  makeTask,
  makeUser,
  sessionUser,
} from './helpers/factories';

const D = (s: string) => new Date(s);
const t = (mins: number) => new Date(Date.UTC(2025, 0, 1, 10, mins, 0));

const closed = (
  userId: string,
  startedAt: Date,
  endedAt: Date,
  extra: { taskId?: string; flag?: 'OVERLAPPING' } = {},
) =>
  prisma.timeEntry.create({
    data: {
      userId,
      taskId: extra.taskId ?? null,
      startedAt,
      endedAt,
      durationMin: Math.max(
        1,
        Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000),
      ),
      source: 'MANUAL_FORM',
      flag: extra.flag ?? null,
    },
  });

// =============================================================================
// startTimer
// =============================================================================

describe('startTimer', () => {
  it('first start: creates MANUAL_TIMER with endedAt=null', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });
    const timer = await startTimer(task.id, sessionUser(owner));
    expect(timer.taskId).toBe(task.id);
    const row = await prisma.timeEntry.findUnique({ where: { id: timer.id } });
    expect(row?.endedAt).toBeNull();
    expect(row?.source).toBe('MANUAL_TIMER');
    expect(row?.userId).toBe(owner.id);
  });

  it('starting on task B while A is running auto-stops A with durationMin', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const taskA = await makeTask({ projectId: project.id, creatorId: owner.id });
    const taskB = await makeTask({ projectId: project.id, creatorId: owner.id });

    const tA = await startTimer(taskA.id, sessionUser(owner));
    await prisma.timeEntry.update({
      where: { id: tA.id },
      data: { startedAt: new Date(Date.now() - 5 * 60_000) },
    });
    await startTimer(taskB.id, sessionUser(owner));

    const aAfter = await prisma.timeEntry.findUnique({ where: { id: tA.id } });
    expect(aAfter?.endedAt).not.toBeNull();
    expect(aAfter?.durationMin).toBeGreaterThanOrEqual(4);

    const active = await prisma.timeEntry.findMany({
      where: { userId: owner.id, endedAt: null },
    });
    expect(active).toHaveLength(1);
    expect(active[0]?.taskId).toBe(taskB.id);
  });

  it('non-viewer → 403', async () => {
    const owner = await makeUser();
    const stranger = await makeUser({ role: 'MEMBER' });
    const project = await makeProject({ ownerId: owner.id });
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });
    await expect(
      startTimer(task.id, sessionUser(stranger)),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
  });

  it('non-existent task → NOT_FOUND', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    await expect(
      startTimer('nope', sessionUser(owner)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('strips empty note to null', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });
    const timer = await startTimer(task.id, sessionUser(owner), '   ');
    const row = await prisma.timeEntry.findUnique({ where: { id: timer.id } });
    expect(row?.note).toBeNull();
  });
});

// =============================================================================
// stopTimer
// =============================================================================

describe('stopTimer', () => {
  it('closes active timer with rounded durationMin', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });
    const timer = await startTimer(task.id, sessionUser(owner));
    await prisma.timeEntry.update({
      where: { id: timer.id },
      data: { startedAt: new Date(Date.now() - 7 * 60_000) },
    });
    const stopped = await stopTimer(owner.id);
    expect(stopped!.endedAt).not.toBeNull();
    expect(stopped!.durationMin).toBeGreaterThanOrEqual(7);
    expect(stopped!.durationMin).toBeLessThanOrEqual(8);
  });

  it('no active → returns null', async () => {
    const owner = await makeUser();
    expect(await stopTimer(owner.id)).toBeNull();
  });

  it('sub-second ticker → durationMin = 1', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });
    await startTimer(task.id, sessionUser(owner));
    const stopped = await stopTimer(owner.id);
    expect(stopped!.durationMin).toBe(1);
  });

  it('appends note to existing one when both present', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });
    await startTimer(task.id, sessionUser(owner), 'first');
    await stopTimer(owner.id, 'second');
    const row = await prisma.timeEntry.findFirst({ where: { userId: owner.id } });
    expect(row?.note).toBe('first\nsecond');
  });

  it('only stops MANUAL_TIMER entries (not auto/digital)', async () => {
    const owner = await makeUser();
    const auto = await prisma.timeEntry.create({
      data: {
        userId: owner.id,
        startedAt: new Date(Date.now() - 60_000),
        source: 'AUTO_AGENT',
      },
    });
    expect(await stopTimer(owner.id)).toBeNull();
    const row = await prisma.timeEntry.findUnique({ where: { id: auto.id } });
    expect(row?.endedAt).toBeNull();
  });
});

// =============================================================================
// getActiveTimer
// =============================================================================

describe('getActiveTimer', () => {
  it('null when nothing running', async () => {
    const owner = await makeUser();
    expect(await getActiveTimer(owner.id)).toBeNull();
  });

  it('returns the open MANUAL_TIMER one with task projection', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id, key: 'GFM' });
    const task = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      number: 42,
      title: 'fix it',
    });
    await startTimer(task.id, sessionUser(owner));
    const active = await getActiveTimer(owner.id);
    expect(active?.taskId).toBe(task.id);
    expect(active?.task?.number).toBe(42);
    expect(active?.task?.title).toBe('fix it');
    expect(active?.task?.project.key).toBe('GFM');
  });

  it('does not return stopped timers', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });
    await startTimer(task.id, sessionUser(owner));
    await stopTimer(owner.id);
    expect(await getActiveTimer(owner.id)).toBeNull();
  });

  it('does not return another user’s timer', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    await addMember(project.id, other.id, 'CONTRIBUTOR');
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });
    await startTimer(task.id, sessionUser(other));
    expect(await getActiveTimer(owner.id)).toBeNull();
  });
});

// =============================================================================
// hasOverlappingEntry
// =============================================================================

describe('hasOverlappingEntry', () => {
  it('returns true for fully-inside, partial-left, partial-right intervals', async () => {
    const u = await makeUser();
    await closed(u.id, t(0), t(60));
    expect(await hasOverlappingEntry(u.id, t(20), t(40))).toBe(true);
    const u2 = await makeUser();
    await closed(u2.id, t(20), t(40));
    expect(await hasOverlappingEntry(u2.id, t(0), t(30))).toBe(true);
    const u3 = await makeUser();
    await closed(u3.id, t(20), t(40));
    expect(await hasOverlappingEntry(u3.id, t(30), t(60))).toBe(true);
  });

  it('returns true when an open-ended timer is in the range', async () => {
    const u = await makeUser();
    const project = await makeProject({ ownerId: u.id });
    const task = await makeTask({ projectId: project.id, creatorId: u.id });
    const timer = await startTimer(task.id, sessionUser(u));
    await prisma.timeEntry.update({
      where: { id: timer.id },
      data: { startedAt: t(10) },
    });
    expect(await hasOverlappingEntry(u.id, t(20), t(30))).toBe(true);
  });

  it('returns false for completely-disjoint and adjacent intervals', async () => {
    const u = await makeUser();
    await closed(u.id, t(0), t(30));
    expect(await hasOverlappingEntry(u.id, t(40), t(60))).toBe(false);
    expect(await hasOverlappingEntry(u.id, t(30), t(60))).toBe(false); // adjacent (boundary exclusive)
  });

  it('excludeEntryId works', async () => {
    const u = await makeUser();
    const e = await closed(u.id, t(0), t(60));
    expect(await hasOverlappingEntry(u.id, t(20), t(40))).toBe(true);
    expect(await hasOverlappingEntry(u.id, t(20), t(40), e.id)).toBe(false);
  });

  it('does not match other user’s entries', async () => {
    const u = await makeUser();
    const other = await makeUser();
    await closed(other.id, t(0), t(60));
    expect(await hasOverlappingEntry(u.id, t(20), t(40))).toBe(false);
  });
});

// =============================================================================
// logTimeManually
// =============================================================================

describe('logTimeManually', () => {
  it('computes durationMin and flag=null when no overlap', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });
    const out = await logTimeManually(
      {
        taskId: task.id,
        startedAt: D('2025-02-10T09:00:00Z'),
        endedAt: D('2025-02-10T10:30:00Z'),
      },
      sessionUser(owner),
    );
    expect(out.durationMin).toBe(90);
    expect(out.flag).toBeNull();
  });

  it('flag=OVERLAPPING when overlap; partner row not modified', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });
    const partner = await closed(
      owner.id,
      D('2025-02-10T09:00:00Z'),
      D('2025-02-10T10:00:00Z'),
      { taskId: task.id },
    );
    const out = await logTimeManually(
      {
        taskId: task.id,
        startedAt: D('2025-02-10T09:30:00Z'),
        endedAt: D('2025-02-10T10:30:00Z'),
      },
      sessionUser(owner),
    );
    expect(out.flag).toBe('OVERLAPPING');
    const partnerAfter = await prisma.timeEntry.findUnique({
      where: { id: partner.id },
    });
    expect(partnerAfter?.flag).toBeNull();
  });

  it('non-viewer to a task → 403', async () => {
    const owner = await makeUser();
    const stranger = await makeUser({ role: 'MEMBER' });
    const project = await makeProject({ ownerId: owner.id });
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });
    await expect(
      logTimeManually(
        {
          taskId: task.id,
          startedAt: D('2025-02-10T09:00:00Z'),
          endedAt: D('2025-02-10T10:00:00Z'),
        },
        sessionUser(stranger),
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
  });

  it('no taskId → no project access check, ok', async () => {
    const u = await makeUser({ role: 'MEMBER' });
    const out = await logTimeManually(
      {
        startedAt: D('2025-02-10T09:00:00Z'),
        endedAt: D('2025-02-10T09:30:00Z'),
      },
      sessionUser(u),
    );
    expect(out.durationMin).toBe(30);
    const row = await prisma.timeEntry.findUnique({ where: { id: out.id } });
    expect(row?.taskId).toBeNull();
    expect(row?.userId).toBe(u.id);
    expect(row?.source).toBe('MANUAL_FORM');
  });

  it('non-existent task → NOT_FOUND', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    await expect(
      logTimeManually(
        {
          taskId: 'bogus',
          startedAt: D('2025-02-10T09:00:00Z'),
          endedAt: D('2025-02-10T10:00:00Z'),
        },
        sessionUser(u),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('< 1 min → durationMin = 1', async () => {
    const u = await makeUser();
    const out = await logTimeManually(
      {
        startedAt: D('2025-02-10T09:00:00Z'),
        endedAt: D('2025-02-10T09:00:10Z'),
      },
      sessionUser(u),
    );
    expect(out.durationMin).toBe(1);
  });
});

// =============================================================================
// editTimeEntry
// =============================================================================

describe('editTimeEntry', () => {
  it('refuses if entry has endedAt=null (active timer)', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });
    const timer = await startTimer(task.id, sessionUser(owner));
    await expect(
      editTimeEntry(
        timer.id,
        { startedAt: D('2025-02-10T09:00:00Z'), endedAt: D('2025-02-10T10:00:00Z') },
        sessionUser(owner),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION', status: 400 });
  });

  it('refuses if user can’t edit (other user’s entry)', async () => {
    const owner = await makeUser();
    const other = await makeUser({ role: 'MEMBER' });
    const entry = await closed(owner.id, D('2025-02-10T09:00:00Z'), D('2025-02-10T10:00:00Z'));
    await expect(
      editTimeEntry(
        entry.id,
        { startedAt: D('2025-02-10T09:30:00Z'), endedAt: D('2025-02-10T10:30:00Z') },
        sessionUser(other),
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
  });

  it('PM/ADMIN can edit other user’s entry', async () => {
    const owner = await makeUser();
    const pm = await makeUser({ role: 'PM' });
    const entry = await closed(owner.id, D('2025-02-10T09:00:00Z'), D('2025-02-10T10:00:00Z'));
    const out = await editTimeEntry(
      entry.id,
      { startedAt: D('2025-02-10T09:00:00Z'), endedAt: D('2025-02-10T11:00:00Z') },
      sessionUser(pm),
    );
    expect(out.durationMin).toBe(120);
  });

  it('clears OVERLAPPING when moved to free slot', async () => {
    const owner = await makeUser();
    await closed(owner.id, D('2025-02-10T09:00:00Z'), D('2025-02-10T10:00:00Z'));
    const entry = await closed(
      owner.id,
      D('2025-02-10T09:30:00Z'),
      D('2025-02-10T10:30:00Z'),
      { flag: 'OVERLAPPING' },
    );
    const out = await editTimeEntry(
      entry.id,
      { startedAt: D('2025-02-10T11:00:00Z'), endedAt: D('2025-02-10T12:00:00Z') },
      sessionUser(owner),
    );
    expect(out.flag).toBeNull();
  });

  it('sets OVERLAPPING when moved into busy slot', async () => {
    const owner = await makeUser();
    await closed(owner.id, D('2025-02-10T09:00:00Z'), D('2025-02-10T10:00:00Z'));
    const entry = await closed(
      owner.id,
      D('2025-02-10T11:00:00Z'),
      D('2025-02-10T12:00:00Z'),
    );
    const out = await editTimeEntry(
      entry.id,
      { startedAt: D('2025-02-10T09:30:00Z'), endedAt: D('2025-02-10T10:30:00Z') },
      sessionUser(owner),
    );
    expect(out.flag).toBe('OVERLAPPING');
  });

  it('excludeEntryId in overlap check excludes the entry itself', async () => {
    const owner = await makeUser();
    const entry = await closed(
      owner.id,
      D('2025-02-10T09:00:00Z'),
      D('2025-02-10T10:00:00Z'),
    );
    const out = await editTimeEntry(
      entry.id,
      { startedAt: D('2025-02-10T09:00:00Z'), endedAt: D('2025-02-10T10:30:00Z') },
      sessionUser(owner),
    );
    expect(out.flag).toBeNull();
  });

  it('changing taskId verifies access to new task', async () => {
    const owner = await makeUser({ role: 'MEMBER' });
    const otherOwner = await makeUser();
    const otherProject = await makeProject({ ownerId: otherOwner.id, key: 'OOO' });
    const otherTask = await makeTask({
      projectId: otherProject.id,
      creatorId: otherOwner.id,
    });
    const entry = await closed(
      owner.id,
      D('2025-02-10T09:00:00Z'),
      D('2025-02-10T10:00:00Z'),
    );
    await expect(
      editTimeEntry(
        entry.id,
        {
          taskId: otherTask.id,
          startedAt: D('2025-02-10T11:00:00Z'),
          endedAt: D('2025-02-10T12:00:00Z'),
        },
        sessionUser(owner),
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
  });

  it('not-found entry → NOT_FOUND', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    await expect(
      editTimeEntry(
        'nope',
        { startedAt: D('2025-02-10T09:00:00Z'), endedAt: D('2025-02-10T10:00:00Z') },
        sessionUser(u),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// =============================================================================
// deleteTimeEntry
// =============================================================================

describe('deleteTimeEntry', () => {
  it('owner/ADMIN/PM can delete; others 403', async () => {
    const owner = await makeUser();
    const stranger = await makeUser({ role: 'MEMBER' });
    const admin = await makeUser({ role: 'ADMIN' });
    const pm = await makeUser({ role: 'PM' });

    for (const actor of [owner, admin, pm]) {
      const e = await closed(owner.id, new Date(Date.now() - 60_000), new Date());
      await deleteTimeEntry(e.id, sessionUser(actor));
      expect(await prisma.timeEntry.findUnique({ where: { id: e.id } })).toBeNull();
    }

    const e = await closed(owner.id, new Date(Date.now() - 60_000), new Date());
    await expect(
      deleteTimeEntry(e.id, sessionUser(stranger)),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
  });

  it('not-found → NOT_FOUND', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    await expect(
      deleteTimeEntry('bogus', sessionUser(u)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// =============================================================================
// getTimeEntry
// =============================================================================

describe('getTimeEntry', () => {
  it('returns own entry with task projection', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id, key: 'XYZ' });
    const task = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      number: 7,
      title: 'task title',
    });
    const entry = await closed(
      owner.id,
      new Date(Date.now() - 60_000),
      new Date(),
      { taskId: task.id },
    );
    const out = await getTimeEntry(entry.id, sessionUser(owner));
    expect(out.id).toBe(entry.id);
    expect(out.task?.number).toBe(7);
    expect(out.task?.title).toBe('task title');
    expect(out.task?.project.key).toBe('XYZ');
  });

  it('cannot access other user’s entry', async () => {
    const owner = await makeUser();
    const other = await makeUser({ role: 'MEMBER' });
    const entry = await closed(owner.id, new Date(Date.now() - 60_000), new Date());
    await expect(
      getTimeEntry(entry.id, sessionUser(other)),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
  });

  it('not-found → NOT_FOUND', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    await expect(
      getTimeEntry('bogus', sessionUser(u)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns null task when entry has no taskId', async () => {
    const owner = await makeUser();
    const entry = await closed(owner.id, new Date(Date.now() - 60_000), new Date());
    const out = await getTimeEntry(entry.id, sessionUser(owner));
    expect(out.task).toBeNull();
  });
});

// =============================================================================
// listTimeEntries
// =============================================================================

describe('listTimeEntries', () => {
  it('filters by from/to range, ordered desc by startedAt', async () => {
    const owner = await makeUser();
    const dates = [
      D('2025-02-10T08:00:00Z'),
      D('2025-02-10T11:00:00Z'),
      D('2025-02-10T14:00:00Z'),
      D('2025-02-09T10:00:00Z'),
      D('2025-02-11T10:00:00Z'),
    ];
    for (const d of dates) {
      await closed(owner.id, d, new Date(d.getTime() + 30 * 60_000));
    }
    const out = await listTimeEntries(owner.id, {
      from: D('2025-02-10T00:00:00Z'),
      to: D('2025-02-11T00:00:00Z'),
    });
    expect(out).toHaveLength(3);
    expect(out[0]?.startedAt.toISOString()).toBe('2025-02-10T14:00:00.000Z');
    expect(out[2]?.startedAt.toISOString()).toBe('2025-02-10T08:00:00.000Z');
  });

  it('does not return another user’s entries', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await closed(b.id, D('2025-02-10T10:00:00Z'), D('2025-02-10T11:00:00Z'));
    const out = await listTimeEntries(a.id, {
      from: D('2025-02-10T00:00:00Z'),
      to: D('2025-02-11T00:00:00Z'),
    });
    expect(out).toHaveLength(0);
  });

  it('includes task and project projection', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id, key: 'AAA' });
    const task = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      title: 'titled',
    });
    await closed(owner.id, D('2025-02-10T10:00:00Z'), D('2025-02-10T11:00:00Z'), {
      taskId: task.id,
    });
    const out = await listTimeEntries(owner.id, {
      from: D('2025-02-10T00:00:00Z'),
      to: D('2025-02-11T00:00:00Z'),
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.task?.title).toBe('titled');
    expect(out[0]?.task?.project.key).toBe('AAA');
  });
});

// =============================================================================
// resolveRange
// =============================================================================

describe('resolveRange', () => {
  it('today → 00:00 today to 00:00 tomorrow', () => {
    const { from, to } = resolveRange('today');
    expect(from.getHours()).toBe(0);
    expect(from.getMinutes()).toBe(0);
    expect(from.getSeconds()).toBe(0);
    expect(to.getTime() - from.getTime()).toBe(24 * 3600 * 1000);
  });

  it('week → Monday-start to next Monday', () => {
    const { from, to } = resolveRange('week');
    expect(from.getHours()).toBe(0);
    // (day + 6) % 7 — Monday is 0 after the shift.
    expect((from.getDay() + 6) % 7).toBe(0);
    expect(to.getTime() - from.getTime()).toBe(7 * 24 * 3600 * 1000);
  });

  it('month → 1st day to next month 1st day', () => {
    const { from, to } = resolveRange('month');
    expect(from.getDate()).toBe(1);
    expect(from.getHours()).toBe(0);
    expect(to.getDate()).toBe(1);
    expect(to.getMonth()).toBe((from.getMonth() + 1) % 12);
  });

  it('custom with from/to strings → ISO with +1 day on `to`', () => {
    const { from, to } = resolveRange('custom', '2025-02-10', '2025-02-12');
    expect(from.getFullYear()).toBe(2025);
    expect(from.getMonth()).toBe(1);
    expect(from.getDate()).toBe(10);
    expect(from.getHours()).toBe(0);
    // `to` is exclusive: 2025-02-12 string → 2025-02-13 00:00
    expect(to.getDate()).toBe(13);
    expect(to.getMonth()).toBe(1);
  });

  it('custom without dates: defaults to today..tomorrow', () => {
    const { from, to } = resolveRange('custom');
    const now = new Date();
    expect(from.getFullYear()).toBe(now.getFullYear());
    expect(from.getMonth()).toBe(now.getMonth());
    expect(from.getDate()).toBe(now.getDate());
    expect(from.getHours()).toBe(0);
    expect(to.getTime() - from.getTime()).toBe(24 * 3600 * 1000);
  });

  it('custom with only from string: to defaults to today+1', () => {
    const { from, to } = resolveRange('custom', '2025-02-10');
    expect(from.getDate()).toBe(10);
    expect(from.getMonth()).toBe(1);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    today.setDate(today.getDate() + 1);
    expect(to.getDate()).toBe(today.getDate());
  });
});
