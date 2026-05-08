import { prisma } from '@giper/db';
import type { SessionUser } from '../permissions';

export type DeadlineItem = {
  id: string;
  number: number;
  title: string;
  dueDate: Date;
  internalStatus: string;
  priority: string;
  projectKey: string;
  assignee: { id: string; name: string; image: string | null } | null;
};

/**
 * Tasks with `dueDate` falling inside [from, to). Filtered to what the
 * current user is allowed to see — same rules as the rest of the app:
 *   - ADMIN / PM see everything
 *   - everyone else: tasks they own, are assigned to, watch, review,
 *     or co-assigned on
 *
 * Done/Canceled tasks are still shown if their dueDate is in-range —
 * useful to see "completed on time" vs "overdue at close".
 */
export async function getDeadlinesInRange(
  from: Date,
  to: Date,
  user: SessionUser,
): Promise<DeadlineItem[]> {
  const isPrivileged = user.role === 'ADMIN' || user.role === 'PM';
  const where: Parameters<typeof prisma.task.findMany>[0]['where'] = {
    dueDate: { gte: from, lt: to },
  };
  if (!isPrivileged) {
    where.OR = [
      { creatorId: user.id },
      { assigneeId: user.id },
      { reviewerId: user.id },
      { assignments: { some: { userId: user.id } } },
      { watchers: { some: { userId: user.id } } },
    ];
  }
  const rows = await prisma.task.findMany({
    where,
    orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }],
    select: {
      id: true,
      number: true,
      title: true,
      dueDate: true,
      internalStatus: true,
      priority: true,
      project: { select: { key: true } },
      assignee: { select: { id: true, name: true, image: true } },
    },
  });
  return rows
    .filter((r): r is typeof r & { dueDate: Date } => r.dueDate !== null)
    .map((r) => ({
      id: r.id,
      number: r.number,
      title: r.title,
      dueDate: r.dueDate,
      internalStatus: r.internalStatus,
      priority: r.priority,
      projectKey: r.project.key,
      assignee: r.assignee,
    }));
}
