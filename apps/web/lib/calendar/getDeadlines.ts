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
  projectName: string;
  externalSource: string | null;
  assignee: { id: string; name: string; image: string | null } | null;
};

export type DeadlineFilters = {
  /** Restrict to tasks the user personally owns (false = team-wide). */
  myOnly?: boolean;
  /** Project key whitelist (case-insensitive). Empty = no filter. */
  projectKey?: string;
  /** Assignee user id. */
  assigneeId?: string;
  /** Status whitelist. Empty = all (open + closed). */
  status?: string[];
};

const PER_STAKE = (uid: string) =>
  ({
    OR: [
      { creatorId: uid },
      { assigneeId: uid },
      { reviewerId: uid },
      { assignments: { some: { userId: uid } } },
      { watchers: { some: { userId: uid } } },
    ],
  }) as const;

/**
 * Tasks with `dueDate` in [from, to). Filtered by the caller's role
 * AND any of the optional filters.
 *
 * Visibility rules:
 *   - ADMIN / PM: full team-wide view by default; pass `myOnly:true`
 *     to narrow to their own stake.
 *   - everyone else: always per-stake (the helper's filter is added
 *     unconditionally for them).
 */
export async function getDeadlinesInRange(
  from: Date,
  to: Date,
  user: SessionUser,
  filters: DeadlineFilters = {},
): Promise<DeadlineItem[]> {
  const isPrivileged = user.role === 'ADMIN' || user.role === 'PM';
  const visibilityClause =
    isPrivileged && !filters.myOnly ? {} : PER_STAKE(user.id);

  const where: Parameters<typeof prisma.task.findMany>[0]['where'] = {
    dueDate: { gte: from, lt: to },
    ...visibilityClause,
    ...(filters.projectKey
      ? { project: { key: filters.projectKey.toUpperCase() } }
      : {}),
    ...(filters.assigneeId ? { assigneeId: filters.assigneeId } : {}),
    ...(filters.status && filters.status.length
      ? { internalStatus: { in: filters.status as never } }
      : {}),
  };

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
      externalSource: true,
      project: { select: { key: true, name: true } },
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
      projectName: r.project.name,
      externalSource: r.externalSource,
      assignee: r.assignee,
    }));
}
