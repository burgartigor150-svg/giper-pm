import { prisma } from '@giper/db';

const taskSelect = {
  id: true,
  number: true,
  title: true,
  status: true,
  priority: true,
  dueDate: true,
  project: { select: { key: true } },
} as const;

/** Up to 5 of my IN_PROGRESS / REVIEW tasks, ordered by recent activity. */
export async function listMyInProgress(userId: string) {
  return prisma.task.findMany({
    where: {
      assigneeId: userId,
      status: { in: ['IN_PROGRESS', 'REVIEW'] },
    },
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    take: 5,
    select: taskSelect,
  });
}

function startOfTodayUTC(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** My tasks with dueDate today (any active status). */
export async function listDueToday(userId: string) {
  const from = startOfTodayUTC();
  const to = new Date(from.getTime() + 24 * 3600_000);
  return prisma.task.findMany({
    where: {
      assigneeId: userId,
      dueDate: { gte: from, lt: to },
      status: { notIn: ['DONE', 'CANCELED'] },
    },
    orderBy: { dueDate: 'asc' },
    take: 10,
    select: taskSelect,
  });
}

/** My tasks past their dueDate, still open. */
export async function listOverdue(userId: string) {
  const from = startOfTodayUTC();
  return prisma.task.findMany({
    where: {
      assigneeId: userId,
      dueDate: { lt: from },
      status: { notIn: ['DONE', 'CANCELED'] },
    },
    orderBy: { dueDate: 'asc' },
    take: 10,
    select: taskSelect,
  });
}

export type DashboardTask = Awaited<ReturnType<typeof listMyInProgress>>[number];
