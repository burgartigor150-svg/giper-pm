import { prisma, type Prisma, type TaskStatus } from '@giper/db';
import { DomainError } from '../errors';
import { DEFAULT_BOARD_COLUMNS } from '../board/defaultColumns';
import { canViewProject, canViewAllProjectTasks, type SessionUser } from '../permissions';
import { getTasksSpentMinutes } from '../time/getTaskSpent';
import {
  buildTaskFilterClauses,
  type TaskTypeFilter,
  type DueWithinFilter,
} from './buildTaskFilterClauses';

export type BoardFilter = {
  assigneeId?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  q?: string;
  onlyMine?: boolean;
  /** Tag IDs (from Tag model) — task must have ALL of them assigned. */
  tagIds?: string[];
  /** Task type (TASK/BUG/FEATURE/EPIC/CHORE). */
  type?: TaskTypeFilter;
  /** Relative due-date window — still-open cards due in the window. */
  dueWithin?: DueWithinFilter;
  /** When 'me', restrict to cards where the viewer is the reviewer. */
  reviewer?: 'me';
  /** Release/version id the card must be slated for. */
  versionId?: string;
  /** Component id the card must belong to. */
  componentId?: string;
  /**
   * Sprint scope. A sprint id restricts to that sprint's cards; `null`
   * restricts to the backlog (no sprint); undefined = no sprint filter.
   * Applied as a top-level AND so the per-stake OR is preserved.
   */
  sprintId?: string | null;
};

/**
 * A board column as the UI consumes it — backed by a first-class BoardColumn
 * row when the project has them, else synthesized from {@link DEFAULT_BOARD_COLUMNS}.
 */
/** A sub-column (sub-stage) inside a board column. */
export type BoardSubColumnView = {
  id: string;
  columnId: string;
  name: string;
  order: number;
  wipLimit: number | null;
};

export type BoardColumnView = {
  id: string;
  name: string;
  status: TaskStatus;
  order: number;
  wipLimit: number | null;
  /** Sub-columns under this column; [] = none (column behaves as before). */
  subColumns: BoardSubColumnView[];
};

/**
 * A board swimlane (horizontal lane) as the UI consumes it. Optional — a
 * project with no swimlanes renders as a single implicit lane.
 */
export type BoardSwimlaneView = {
  id: string;
  name: string;
  order: number;
  wipLimit: number | null;
};

// Default columns moved to a leaf module (so the backfill / test factory can
// import them without this file's server chain). Re-exported for compatibility.
export { DEFAULT_BOARD_COLUMNS };

/** All non-CANCELED tasks for the project, no pagination — kanban shows everything. */
export async function listTasksForBoard(
  projectKey: string,
  filter: BoardFilter,
  user: SessionUser,
) {
  const project = await prisma.project.findUnique({
    where: { key: projectKey },
    select: {
      id: true,
      key: true,
      name: true,
      ownerId: true,
      externalSource: true,
      wipLimits: true,
      members: {
        select: {
          userId: true,
          role: true,
          user: { select: { id: true, name: true, image: true } },
        },
      },
    },
  });
  if (!project) throw new DomainError('NOT_FOUND', 404);
  // Bitrix-mirror groups have no ProjectMember rows for our users, so
  // membership is inferred from owning at least one task there.
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
  if (
    !canViewProject(user, {
      ...project,
      hasTaskForCurrentUser: userTaskCount > 0,
    })
  ) {
    throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);
  }

  // Kanban buckets by *internal* status now — that's the team's track.
  // For non-mirrored tasks internalStatus was backfilled from status at
  // migration time, so behaviour is identical there. For Bitrix-mirrored
  // tasks the board reflects what our team is doing, not what the client
  // sees in Bitrix (they look at Bitrix for that).
  const where: Prisma.TaskWhereInput = {
    projectId: project.id,
    internalStatus: { not: 'CANCELED' },
  };

  // Per-stake for regular members: they see only tasks they personally are
  // on. Leadership (ADMIN / project owner / project LEAD) sees every task in
  // the project — the full mirror of the Bitrix workgroup — via the bypass.
  if (!canViewAllProjectTasks(user, project)) {
    where.OR = [
      { creatorId: user.id },
      { assigneeId: user.id },
      { reviewerId: user.id },
      { assignments: { some: { userId: user.id } } },
      { watchers: { some: { userId: user.id } } },
    ];
  }

  // onlyMine wins over explicit assigneeId
  if (filter.onlyMine) {
    where.assigneeId = user.id;
  } else if (filter.assigneeId) {
    where.assigneeId = filter.assigneeId;
  }

  // Sprint scope: top-level key → ANDed with the per-stake OR (never clobbers
  // it). `null` means backlog (sprintId IS NULL); a string means that sprint.
  if (filter.sprintId !== undefined) where.sprintId = filter.sprintId;

  if (filter.priority) where.priority = filter.priority;
  // q / tags / type / dueWithin / reviewer all go into AND so they NEVER
  // clobber the per-stake `where.OR` access-control clause set above. (A past
  // bug REASSIGNED `where.OR` on `q`, dropping the stake scope and leaking
  // Bitrix-mirror tasks the viewer isn't a stakeholder on.) The shared builder
  // is the single place that produces these narrowing clauses — board buckets
  // by internalStatus, so the overdue guard reads that track.
  const and = buildTaskFilterClauses(
    {
      q: filter.q,
      tagIds: filter.tagIds,
      type: filter.type,
      dueWithin: filter.dueWithin,
      reviewerMe: filter.reviewer === 'me',
      versionId: filter.versionId,
      componentId: filter.componentId,
    },
    { userId: user.id, statusField: 'internalStatus' },
  );
  if (and.length > 0) where.AND = and;

  const rawTasks = await prisma.task.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      number: true,
      title: true,
      // We keep `status` (Bitrix-mirror) and `internalStatus` (team)
      // both available; the board card uses internalStatus and falls
      // back to status only for non-mirrored tasks where they're equal.
      status: true,
      internalStatus: true,
      // Board placement source of truth (S3): the card's column. Backfilled
      // 1:1 from internalStatus at migration time, dual-written by the status
      // cores. The board prefers it when it points to a live, status-consistent
      // column, else falls back to the 1:1 status→column map.
      columnId: true,
      swimlaneId: true,
      subColumnId: true,
      priority: true,
      type: true,
      estimateHours: true,
      storyPoints: true,
      coverImageKey: true,
      coverColor: true,
      tags: true,
      externalSource: true,
      // Hierarchy markers: is this a subtask, and how many children it has.
      parentId: true,
      _count: { select: { subtasks: true } },
      assignee: { select: { id: true, name: true, image: true } },
      taskTags: {
        select: {
          tag: { select: { id: true, name: true, color: true } },
        },
      },
    },
  });

  // Batch-load spent minutes for every visible task — one round trip.
  // We only enrich tasks that actually have an estimate (otherwise the
  // overrun marker has nothing to compare against).
  const allIds = rawTasks.map((t) => t.id);
  const estimateIds = rawTasks.filter((t) => t.estimateHours != null).map((t) => t.id);
  const [spent, openBlockers] = await Promise.all([
    getTasksSpentMinutes(estimateIds),
    countOpenBlockers(allIds),
  ]);

  const tasks = rawTasks.map((t) => ({
    ...t,
    spentMinutes: spent.get(t.id) ?? 0,
    openBlockerCount: openBlockers.get(t.id) ?? 0,
  }));

  // Configurable board columns. Prefer the project's first-class BoardColumn
  // rows; fall back to a synthesized default set for projects that predate the
  // board migration. CANCELED is filtered out — the board hides cancelled work.
  // A column's own wipLimit wins; otherwise fall back to the legacy per-status
  // `wipLimits` JSON so existing limits keep working until they're migrated.
  const wipJson = (project.wipLimits ?? null) as Partial<
    Record<TaskStatus, number>
  > | null;
  // Load board columns in a separate query and tolerate the table not existing
  // yet: on deploy the new image goes live a beat before `prisma migrate
  // deploy` runs, so we never want the board to 500 over a missing/empty column
  // set. Any failure (or no rows) falls back to DEFAULT_BOARD_COLUMNS below.
  let dbCols: Array<{
    id: string;
    name: string;
    status: TaskStatus;
    order: number;
    wipLimit: number | null;
  }> = [];
  try {
    dbCols = await prisma.boardColumn.findMany({
      where: { projectId: project.id, status: { not: 'CANCELED' } },
      orderBy: { order: 'asc' },
      select: { id: true, name: true, status: true, order: true, wipLimit: true },
    });
  } catch (e) {
    console.warn(
      'listTasksForBoard: board columns unavailable, falling back to defaults',
      e,
    );
  }
  const baseCols: BoardColumnView[] =
    dbCols.length > 0
      ? dbCols.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          order: c.order,
          wipLimit: c.wipLimit,
          subColumns: [],
        }))
      : DEFAULT_BOARD_COLUMNS.map((c, i) => ({
          id: `default-${c.status}`,
          name: c.name,
          status: c.status,
          order: i,
          wipLimit: null,
          subColumns: [],
        }));

  // Sub-columns (sub-stages) are optional, load fault-tolerantly, grouped under
  // their parent column. Empty for every column until an admin adds them → the
  // board renders exactly as before.
  const subColsByColumn = new Map<string, BoardSubColumnView[]>();
  try {
    const subs = await prisma.boardSubColumn.findMany({
      where: { column: { projectId: project.id } },
      orderBy: { order: 'asc' },
      select: { id: true, columnId: true, name: true, order: true, wipLimit: true },
    });
    for (const s of subs) {
      const arr = subColsByColumn.get(s.columnId);
      if (arr) arr.push(s);
      else subColsByColumn.set(s.columnId, [s]);
    }
  } catch (e) {
    console.warn('listTasksForBoard: sub-columns unavailable', e);
  }

  const columns: BoardColumnView[] = baseCols.map((c) => ({
    ...c,
    wipLimit: c.wipLimit ?? wipJson?.[c.status] ?? null,
    subColumns: subColsByColumn.get(c.id) ?? [],
  }));

  // Swimlanes are optional: a project with none renders as a single implicit
  // lane (today's layout). Load fault-tolerantly, same as columns.
  let swimlanes: BoardSwimlaneView[] = [];
  try {
    swimlanes = await prisma.boardSwimlane.findMany({
      where: { projectId: project.id },
      orderBy: { order: 'asc' },
      select: { id: true, name: true, order: true, wipLimit: true },
    });
  } catch (e) {
    console.warn('listTasksForBoard: swimlanes unavailable', e);
  }

  return { project, tasks, columns, swimlanes };
}

/**
 * For each task in `ids`, count the BLOCKS edges pointing AT it whose
 * source task is still open (not DONE/CANCELED). Single query, group by
 * the target task. Used by the kanban card to surface a 🚫 marker.
 */
async function countOpenBlockers(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.taskDependency.findMany({
    where: {
      toTaskId: { in: ids },
      linkType: 'BLOCKS', // only true blockers gate the card; relates/duplicates don't
      fromTask: { status: { notIn: ['DONE', 'CANCELED'] } },
    },
    select: { toTaskId: true },
  });
  const counts = new Map<string, number>();
  for (const r of rows) {
    counts.set(r.toTaskId, (counts.get(r.toTaskId) ?? 0) + 1);
  }
  return counts;
}

export type BoardTask = Awaited<ReturnType<typeof listTasksForBoard>>['tasks'][number];
