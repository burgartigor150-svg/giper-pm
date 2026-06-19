import { prisma, type TaskStatus } from '@giper/db';
import { DomainError } from '../errors';
import { canViewProject, type SessionUser } from '../permissions';

export type GanttTask = {
  number: number;
  title: string;
  status: TaskStatus;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  /** Bar start (ISO date) — startedAt, else createdAt. */
  start: string;
  /** Bar end (ISO date) — completedAt, else dueDate, else start. */
  end: string;
  /** True when the task has a real dueDate (vs an inferred end). */
  hasDue: boolean;
  /** Open task past its dueDate. */
  overdue: boolean;
  assignee: { name: string } | null;
};

/**
 * Timeline/Gantt data for a project, scoped to the viewer's task stakes
 * (same per-stake visibility rule as the board). Reuses existing Task date
 * fields — no new columns. CANCELED tasks are hidden.
 */
export async function getGanttData(projectKey: string, user: SessionUser) {
  const project = await prisma.project.findUnique({
    where: { key: projectKey },
    select: {
      id: true,
      key: true,
      name: true,
      ownerId: true,
      members: { select: { userId: true, role: true } },
    },
  });
  if (!project) throw new DomainError('NOT_FOUND', 404);

  const userTaskCount = await prisma.task.count({
    where: {
      projectId: project.id,
      OR: [
        { creatorId: user.id },
        { assigneeId: user.id },
        { assignments: { some: { userId: user.id } } },
      ],
    },
  });
  if (!canViewProject(user, { ...project, hasTaskForCurrentUser: userTaskCount > 0 })) {
    throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);
  }

  const rows = await prisma.task.findMany({
    where: {
      projectId: project.id,
      internalStatus: { not: 'CANCELED' },
      OR: [
        { creatorId: user.id },
        { assigneeId: user.id },
        { reviewerId: user.id },
        { assignments: { some: { userId: user.id } } },
        { watchers: { some: { userId: user.id } } },
      ],
    },
    orderBy: [{ startedAt: 'asc' }, { createdAt: 'asc' }],
    select: {
      number: true,
      title: true,
      internalStatus: true,
      priority: true,
      createdAt: true,
      startedAt: true,
      dueDate: true,
      completedAt: true,
      assignee: { select: { name: true } },
    },
  });

  const now = Date.now();
  const tasks: GanttTask[] = rows.map((t) => {
    const start = t.startedAt ?? t.createdAt;
    const end = t.completedAt ?? t.dueDate ?? start;
    const isOpen = t.internalStatus !== 'DONE';
    return {
      number: t.number,
      title: t.title,
      status: t.internalStatus,
      priority: t.priority,
      start: start.toISOString(),
      end: end.toISOString(),
      hasDue: !!t.dueDate,
      overdue: !!t.dueDate && t.dueDate.getTime() < now && isOpen,
      assignee: t.assignee ? { name: t.assignee.name } : null,
    };
  });

  return { project: { key: project.key, name: project.name }, tasks };
}
