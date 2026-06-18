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

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { updateRecurringTasksAction } from '@/actions/recurringTasks';
import { prisma } from '@giper/db';
import { makeProject, makeUser } from './helpers/factories';

beforeEach(() => {
  mockMe.role = 'ADMIN';
});

function rule(over: Partial<Parameters<typeof updateRecurringTasksAction>[1][number]> = {}) {
  return {
    id: null,
    title: 'Еженедельный отчёт',
    type: 'TASK' as const,
    priority: 'MEDIUM' as const,
    intervalDays: 7,
    startDate: '2026-07-01',
    active: true,
    ...over,
  };
}

describe('updateRecurringTasksAction', () => {
  it('creates a recurring rule with nextRunAt derived from startDate', async () => {
    const owner = await makeUser();
    mockMe.id = owner.id;
    const project = await makeProject({ ownerId: owner.id });

    const res = await updateRecurringTasksAction(project.id, [rule()]);
    expect(res.ok).toBe(true);

    const rows = await prisma.recurringTask.findMany({ where: { projectId: project.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.intervalDays).toBe(7);
    expect(rows[0]?.nextRunAt.toISOString()).toBe('2026-07-01T06:00:00.000Z'); // 09:00 MSK
  });

  it('reconciles: dropping a rule from the set deletes it', async () => {
    const owner = await makeUser();
    mockMe.id = owner.id;
    const project = await makeProject({ ownerId: owner.id });

    await updateRecurringTasksAction(project.id, [rule({ title: 'Один' })]);
    await updateRecurringTasksAction(project.id, []); // empty set → delete all

    const count = await prisma.recurringTask.count({ where: { projectId: project.id } });
    expect(count).toBe(0);
  });

  it('rejects an interval below 1', async () => {
    const owner = await makeUser();
    mockMe.id = owner.id;
    const project = await makeProject({ ownerId: owner.id });

    const res = await updateRecurringTasksAction(project.id, [rule({ intervalDays: 0 })]);
    expect(res.ok).toBe(false);
  });

  it('rejects a malformed start date', async () => {
    const owner = await makeUser();
    mockMe.id = owner.id;
    const project = await makeProject({ ownerId: owner.id });

    const res = await updateRecurringTasksAction(project.id, [rule({ startDate: 'not-a-date' })]);
    expect(res.ok).toBe(false);
  });

  it('forbids a VIEWER from editing rules', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    mockMe.id = (await makeUser({ role: 'VIEWER' })).id;
    mockMe.role = 'VIEWER';

    const res = await updateRecurringTasksAction(project.id, [rule()]);
    expect(res.ok).toBe(false);
  });
});
