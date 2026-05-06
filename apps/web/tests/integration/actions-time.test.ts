import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMe = {
  id: '',
  role: 'ADMIN' as 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER',
  name: 'A',
  email: 'a@a',
  image: null,
  mustChangePassword: false,
};

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => mockMe),
  requireRole: vi.fn(async () => mockMe),
  signOut: vi.fn(),
  signIn: vi.fn(),
}));

const redirectMock = vi.fn();
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    redirectMock(url);
    const e = new Error('NEXT_REDIRECT');
    (e as { digest?: string }).digest = 'NEXT_REDIRECT;' + url;
    throw e;
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import {
  startTimerAction,
  stopTimerAction,
  getActiveTimerAction,
  logTimeAction,
  editTimeEntryAction,
  deleteTimeEntryAction,
} from '@/actions/time';
import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { makeProject, makeTask, makeUser } from './helpers/factories';

beforeEach(() => {
  redirectMock.mockClear();
  vi.mocked(revalidatePath).mockClear();
  mockMe.role = 'ADMIN';
});

// ----- startTimerAction ---------------------------------------------------

describe('startTimerAction', () => {
  it('starts a timer (happy path)', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;
    const p = await makeProject({ ownerId: u.id, key: 'TMR' });
    const t = await makeTask({ projectId: p.id, creatorId: u.id });

    const res = await startTimerAction(t.id);
    expect(res).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');

    const active = await prisma.timeEntry.findFirst({
      where: { userId: u.id, endedAt: null, source: 'MANUAL_TIMER' },
    });
    expect(active).not.toBeNull();
    expect(active?.taskId).toBe(t.id);
  });

  it('returns NOT_FOUND for unknown task', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;
    const res = await startTimerAction('00000000-0000-0000-0000-000000000000');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_FOUND');
  });

  it('returns INSUFFICIENT_PERMISSIONS when MEMBER not in project', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    const stranger = await makeUser({ role: 'MEMBER' });
    const p = await makeProject({ ownerId: owner.id, key: 'PRX' });
    const t = await makeTask({ projectId: p.id, creatorId: owner.id });

    mockMe.id = stranger.id;
    mockMe.role = 'MEMBER';
    const res = await startTimerAction(t.id);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('stops a previous timer when starting a new one', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;
    const p = await makeProject({ ownerId: u.id, key: 'TM2' });
    const t1 = await makeTask({ projectId: p.id, creatorId: u.id });
    const t2 = await makeTask({ projectId: p.id, creatorId: u.id });

    await startTimerAction(t1.id);
    // Wait so the first timer's start is at least 1ms in the past.
    await new Promise((r) => setTimeout(r, 5));
    await startTimerAction(t2.id);

    const active = await prisma.timeEntry.findMany({
      where: { userId: u.id, endedAt: null, source: 'MANUAL_TIMER' },
    });
    expect(active).toHaveLength(1);
    expect(active[0]?.taskId).toBe(t2.id);

    const all = await prisma.timeEntry.findMany({ where: { userId: u.id } });
    expect(all.length).toBe(2);
  });
});

// ----- stopTimerAction ---------------------------------------------------

describe('stopTimerAction', () => {
  it('stops the active timer', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;
    const p = await makeProject({ ownerId: u.id, key: 'STP' });
    const t = await makeTask({ projectId: p.id, creatorId: u.id });

    await startTimerAction(t.id);
    const res = await stopTimerAction();
    expect(res).toEqual({ ok: true });

    const stillActive = await prisma.timeEntry.findFirst({
      where: { userId: u.id, endedAt: null, source: 'MANUAL_TIMER' },
    });
    expect(stillActive).toBeNull();
  });

  it('is no-op when nothing is running', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;
    const res = await stopTimerAction();
    expect(res).toEqual({ ok: true });
  });
});

// ----- getActiveTimerAction ----------------------------------------------

describe('getActiveTimerAction', () => {
  it('returns null when no active timer', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;
    const result = await getActiveTimerAction();
    expect(result).toBeNull();
  });

  it('returns active timer with task', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;
    const p = await makeProject({ ownerId: u.id, key: 'AT0' });
    const t = await makeTask({ projectId: p.id, creatorId: u.id, title: 'Working on this' });

    await startTimerAction(t.id);
    const result = await getActiveTimerAction();
    expect(result).not.toBeNull();
    expect(result?.taskId).toBe(t.id);
    expect(result?.task?.title).toBe('Working on this');
  });
});

// ----- logTimeAction -----------------------------------------------------

describe('logTimeAction', () => {
  it('logs time without task (happy path)', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;

    const fd = new FormData();
    fd.set('date', '2025-04-01');
    fd.set('startTime', '09:00');
    fd.set('endTime', '10:30');

    const res = await logTimeAction(null, fd);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data?.flag).toBeNull();

    expect(revalidatePath).toHaveBeenCalledWith('/time');

    const entries = await prisma.timeEntry.findMany({ where: { userId: u.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.durationMin).toBe(90);
    expect(entries[0]?.source).toBe('MANUAL_FORM');
  });

  it('logs time with task', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;
    const p = await makeProject({ ownerId: u.id, key: 'LGT' });
    const t = await makeTask({ projectId: p.id, creatorId: u.id });

    const fd = new FormData();
    fd.set('taskId', t.id);
    fd.set('date', '2025-04-01');
    fd.set('startTime', '09:00');
    fd.set('endTime', '10:00');

    const res = await logTimeAction(null, fd);
    expect(res.ok).toBe(true);

    const entries = await prisma.timeEntry.findMany({ where: { userId: u.id } });
    expect(entries[0]?.taskId).toBe(t.id);
    expect(entries[0]?.durationMin).toBe(60);
  });

  it('flags overlapping entries', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;

    const first = new FormData();
    first.set('date', '2025-04-02');
    first.set('startTime', '09:00');
    first.set('endTime', '10:00');
    const r1 = await logTimeAction(null, first);
    expect(r1.ok).toBe(true);

    const second = new FormData();
    second.set('date', '2025-04-02');
    second.set('startTime', '09:30');
    second.set('endTime', '10:30');
    const r2 = await logTimeAction(null, second);
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.data?.flag).toBe('OVERLAPPING');
  });

  it('returns VALIDATION when end is before start', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;

    const fd = new FormData();
    fd.set('date', '2025-04-01');
    fd.set('startTime', '11:00');
    fd.set('endTime', '10:00');

    const res = await logTimeAction(null, fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
  });

  it('returns VALIDATION when required fields are missing', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;
    const fd = new FormData();
    const res = await logTimeAction(null, fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
  });

  it('returns NOT_FOUND when task does not exist', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;

    const fd = new FormData();
    fd.set('taskId', '00000000-0000-0000-0000-000000000000');
    fd.set('date', '2025-04-01');
    fd.set('startTime', '09:00');
    fd.set('endTime', '10:00');

    const res = await logTimeAction(null, fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_FOUND');
  });
});

// ----- editTimeEntryAction -----------------------------------------------

describe('editTimeEntryAction', () => {
  it('edits an entry and redirects', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;

    const entry = await prisma.timeEntry.create({
      data: {
        userId: u.id,
        startedAt: new Date('2025-03-01T09:00:00'),
        endedAt: new Date('2025-03-01T10:00:00'),
        durationMin: 60,
        source: 'MANUAL_FORM',
      },
    });

    const fd = new FormData();
    fd.set('date', '2025-03-01');
    fd.set('startTime', '09:00');
    fd.set('endTime', '11:00');

    await expect(editTimeEntryAction(entry.id, null, fd)).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith('/time');
    expect(revalidatePath).toHaveBeenCalledWith('/time');

    const updated = await prisma.timeEntry.findUnique({ where: { id: entry.id } });
    expect(updated?.durationMin).toBe(120);
  });

  it('returns VALIDATION when end < start', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;

    const entry = await prisma.timeEntry.create({
      data: {
        userId: u.id,
        startedAt: new Date('2025-03-01T09:00:00'),
        endedAt: new Date('2025-03-01T10:00:00'),
        durationMin: 60,
        source: 'MANUAL_FORM',
      },
    });

    const fd = new FormData();
    fd.set('date', '2025-03-01');
    fd.set('startTime', '11:00');
    fd.set('endTime', '10:00');

    const res = await editTimeEntryAction(entry.id, null, fd);
    expect(res?.ok).toBe(false);
    if (res && !res.ok) expect(res.error.code).toBe('VALIDATION');
  });

  it('returns NOT_FOUND for unknown entry id', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;

    const fd = new FormData();
    fd.set('date', '2025-03-01');
    fd.set('startTime', '09:00');
    fd.set('endTime', '10:00');

    const res = await editTimeEntryAction(
      '00000000-0000-0000-0000-000000000000',
      null,
      fd,
    );
    expect(res?.ok).toBe(false);
    if (res && !res.ok) expect(res.error.code).toBe('NOT_FOUND');
  });

  it('returns INSUFFICIENT_PERMISSIONS when MEMBER edits other’s entry', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    const other = await makeUser({ role: 'MEMBER' });

    const entry = await prisma.timeEntry.create({
      data: {
        userId: owner.id,
        startedAt: new Date('2025-03-01T09:00:00'),
        endedAt: new Date('2025-03-01T10:00:00'),
        durationMin: 60,
        source: 'MANUAL_FORM',
      },
    });

    mockMe.id = other.id;
    mockMe.role = 'MEMBER';

    const fd = new FormData();
    fd.set('date', '2025-03-01');
    fd.set('startTime', '09:00');
    fd.set('endTime', '11:00');

    const res = await editTimeEntryAction(entry.id, null, fd);
    expect(res?.ok).toBe(false);
    if (res && !res.ok) expect(res.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('returns VALIDATION when entry is an active timer', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;

    const entry = await prisma.timeEntry.create({
      data: {
        userId: u.id,
        startedAt: new Date('2025-03-01T09:00:00'),
        endedAt: null,
        source: 'MANUAL_TIMER',
      },
    });

    const fd = new FormData();
    fd.set('date', '2025-03-01');
    fd.set('startTime', '09:00');
    fd.set('endTime', '10:00');

    const res = await editTimeEntryAction(entry.id, null, fd);
    expect(res?.ok).toBe(false);
    if (res && !res.ok) expect(res.error.code).toBe('VALIDATION');
  });
});

// ----- deleteTimeEntryAction ---------------------------------------------

describe('deleteTimeEntryAction', () => {
  it('deletes own entry', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;

    const entry = await prisma.timeEntry.create({
      data: {
        userId: u.id,
        startedAt: new Date('2025-03-01T09:00:00'),
        endedAt: new Date('2025-03-01T10:00:00'),
        durationMin: 60,
        source: 'MANUAL_FORM',
      },
    });

    const res = await deleteTimeEntryAction(entry.id);
    expect(res).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith('/time');
    expect(await prisma.timeEntry.findUnique({ where: { id: entry.id } })).toBeNull();
  });

  it('returns NOT_FOUND for unknown id', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    mockMe.id = u.id;
    const res = await deleteTimeEntryAction('00000000-0000-0000-0000-000000000000');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_FOUND');
  });

  it('returns INSUFFICIENT_PERMISSIONS when MEMBER deletes other’s entry', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    const other = await makeUser({ role: 'MEMBER' });

    const entry = await prisma.timeEntry.create({
      data: {
        userId: owner.id,
        startedAt: new Date('2025-03-01T09:00:00'),
        endedAt: new Date('2025-03-01T10:00:00'),
        durationMin: 60,
        source: 'MANUAL_FORM',
      },
    });

    mockMe.id = other.id;
    mockMe.role = 'MEMBER';

    const res = await deleteTimeEntryAction(entry.id);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });
});
