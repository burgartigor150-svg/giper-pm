import type { Prisma } from '@giper/db';

export type TaskTypeFilter = 'TASK' | 'BUG' | 'FEATURE' | 'EPIC' | 'CHORE';
export type DueWithinFilter = 'overdue' | 'today' | '7' | '30';

/**
 * The optional, NARROWING task filters shared by the board and list queries.
 * Every field here only restricts the result set — none can widen visibility.
 */
export type TaskFilterDims = {
  /** Free text matched against title + description (case-insensitive). */
  q?: string;
  /** Tag IDs the task must ALL carry (AND-semantics). */
  tagIds?: string[];
  /** Task type (TASK/BUG/FEATURE/EPIC/CHORE). */
  type?: TaskTypeFilter;
  /** Relative due-date window — "still-open tasks due in <window>". */
  dueWithin?: DueWithinFilter;
  /** When true, restrict to tasks where the viewer is the assigned reviewer. */
  reviewerMe?: boolean;
};

/**
 * Build the AND-clauses for the optional task filters shared by the board and
 * list queries.
 *
 * CRITICAL (access-control invariant): this returns clauses meant to be
 * APPENDED to the caller's AND array. It NEVER touches the per-stake OR access
 * clause (creator/assignee/reviewer/assignment/watcher) that both queries set
 * separately. Every clause produced here NARROWS the result set; none can widen
 * visibility. A previous bug reassigned `where.OR` on the `q` filter and leaked
 * Bitrix-mirror tasks — keeping all filters as additive AND-clauses is the fix,
 * and this single builder is the one place that logic lives.
 *
 * `statusField` selects which status track the "overdue = still open" guard
 * reads: the board buckets by `internalStatus` (the team track), the list shows
 * `status` (the Bitrix-mirror track).
 */
export function buildTaskFilterClauses(
  dims: TaskFilterDims,
  ctx: { userId: string; statusField: 'status' | 'internalStatus'; now?: Date },
): Prisma.TaskWhereInput[] {
  const and: Prisma.TaskWhereInput[] = [];

  if (dims.q) {
    and.push({
      OR: [
        { title: { contains: dims.q, mode: 'insensitive' } },
        { description: { contains: dims.q, mode: 'insensitive' } },
      ],
    });
  }

  if (dims.tagIds && dims.tagIds.length > 0) {
    // AND-semantics: the task must carry every selected tag.
    for (const tagId of dims.tagIds) {
      and.push({ taskTags: { some: { tagId } } });
    }
  }

  if (dims.type) and.push({ type: dims.type });

  if (dims.reviewerMe) and.push({ reviewerId: ctx.userId });

  if (dims.dueWithin) {
    const now = ctx.now ?? new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // "Still open" guard so a deadline window surfaces actionable work, not
    // already-closed cards. Track-correct: board reads internalStatus.
    const openGuard: Prisma.TaskWhereInput = {
      [ctx.statusField]: { notIn: ['DONE', 'CANCELED'] },
    };
    if (dims.dueWithin === 'overdue') {
      and.push({ dueDate: { lt: now }, ...openGuard });
    } else if (dims.dueWithin === 'today') {
      const endOfToday = new Date(startOfToday);
      endOfToday.setDate(endOfToday.getDate() + 1);
      and.push({ dueDate: { gte: startOfToday, lt: endOfToday }, ...openGuard });
    } else {
      const days = dims.dueWithin === '7' ? 7 : 30;
      const upper = new Date(now);
      upper.setDate(upper.getDate() + days);
      and.push({ dueDate: { gte: startOfToday, lte: upper }, ...openGuard });
    }
  }

  return and;
}
