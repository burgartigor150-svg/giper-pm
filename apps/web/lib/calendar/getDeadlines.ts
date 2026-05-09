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
  /**
   * Visibility scope:
   *   - 'mine' (default) — only tasks the caller is on the hook for
   *     (creator/assignee/reviewer/co-assignee/watcher).
   *   - 'team'           — every visible task. Honoured only for
   *     ADMIN / PM; for everyone else this silently falls back to
   *     'mine' (their stake is the limit of their visibility).
   */
  scope?: 'mine' | 'team';
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
 * Resolve "my team" for the calendar's default scope:
 *   - everyone in MY PmTeamMember list (where I'm the PM)
 *   - my PM's team (where I'm a member)
 *   - me
 *
 * Used as an extra filter on top of PER_STAKE so a PM doesn't see
 * tasks they created for an unrelated department (finance, ОК, …)
 * just because they happen to be the postanovshchik.
 */
async function resolveTeammateIds(uid: string): Promise<string[]> {
  const [asPm, asMember] = await Promise.all([
    prisma.pmTeamMember.findMany({
      where: { pmId: uid },
      select: { memberId: true },
    }),
    prisma.pmTeamMember.findMany({
      where: { memberId: uid },
      select: { pmId: true },
    }),
  ]);
  const ids = new Set<string>([uid]);
  for (const r of asPm) ids.add(r.memberId);
  for (const r of asMember) ids.add(r.pmId);
  // Also include teammates of my PM (so peers see each other's work).
  if (asMember.length) {
    const pmIds = asMember.map((r) => r.pmId);
    const peers = await prisma.pmTeamMember.findMany({
      where: { pmId: { in: pmIds } },
      select: { memberId: true },
    });
    for (const r of peers) ids.add(r.memberId);
  }
  return [...ids];
}

/**
 * Tasks with `dueDate` in [from, to). Filtered by the caller's role
 * AND any of the optional filters.
 *
 * Default scope is 'mine' for everyone — including admins/PMs. The
 * calendar is a personal planning tool; if a PM wants to inspect the
 * whole team's load they have to opt in explicitly via scope='team'.
 */
export async function getDeadlinesInRange(
  from: Date,
  to: Date,
  user: SessionUser,
  filters: DeadlineFilters = {},
): Promise<DeadlineItem[]> {
  const isPrivileged = user.role === 'ADMIN' || user.role === 'PM';
  const teamWide = filters.scope === 'team' && isPrivileged;
  const teammateIds = await resolveTeammateIds(user.id);

  // Visibility (both scopes filter to "my team" — the calendar is a
  // PM tool, never the org-wide view):
  //   - 'mine' (default for all)    → PER_STAKE on the task AND
  //     assignee belongs to my team. Stops a PM from seeing finance/
  //     HR tasks they happen to be the postanovshchik on.
  //   - 'team' (privileged opt-in)  → drops PER_STAKE, but the team
  //     gate stays: shows EVERY task assigned to my teammates,
  //     regardless of whether I'm personally on it.
  const teamGate = {
    OR: [
      // Unassigned tasks I created — keep them visible.
      { assigneeId: null, creatorId: user.id },
      // Tasks assigned to me or to a teammate.
      { assigneeId: { in: teammateIds } },
    ],
  };
  const where: Parameters<typeof prisma.task.findMany>[0]['where'] = teamWide
    ? { dueDate: { gte: from, lt: to }, ...teamGate }
    : {
        dueDate: { gte: from, lt: to },
        AND: [PER_STAKE(user.id), teamGate],
      };

  // Apply additional UI filters on top of the visibility decision.
  if (filters.projectKey) {
    where.project = { key: filters.projectKey.toUpperCase() };
  }
  if (filters.assigneeId) {
    where.assigneeId = filters.assigneeId;
  }
  if (filters.status && filters.status.length) {
    where.internalStatus = { in: filters.status as never };
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
