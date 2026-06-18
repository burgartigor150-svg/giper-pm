import { prisma, type Prisma, type TaskStatus } from '@giper/db';
import { DomainError } from '../errors';
import { canViewProject, type SessionUser } from '../permissions';
import { getTasksSpentMinutes } from '../time/getTaskSpent';

export type BoardFilter = {
  assigneeId?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  q?: string;
  onlyMine?: boolean;
  /** Tag IDs (from Tag model) — task must have ALL of them assigned. */
  tagIds?: string[];
};

/**
 * A board column as the UI consumes it — backed by a first-class BoardColumn
 * row when the project has them, else synthesized from {@link DEFAULT_BOARD_COLUMNS}.
 */
export type BoardColumnView = {
  id: string;
  name: string;
  status: TaskStatus;
  order: number;
  wipLimit: number | null;
};

/**
 * Default columns (Russian labels) for projects with no BoardColumn rows yet —
 * e.g. created before the board migration, or before columns get seeded.
 * CANCELED is intentionally absent: the board hides cancelled work.
 */
const DEFAULT_BOARD_COLUMNS: ReadonlyArray<{ status: TaskStatus; name: string }> = [
  { status: 'BACKLOG', name: 'Бэклог' },
  { status: 'TODO', name: 'К работе' },
  { status: 'IN_PROGRESS', name: 'В работе' },
  { status: 'REVIEW', name: 'На ревью' },
  { status: 'BLOCKED', name: 'Заблокирована' },
  { status: 'DONE', name: 'Готово' },
];

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

  // Strictly per-stake. Project owner / LEAD no longer get every
  // task — for Bitrix-mirror groups that would surface upstream tasks
  // they're not part of. Everyone (ADMIN, PM, owner, LEAD, MEMBER)
  // sees only tasks they personally are on.
  where.OR = [
    { creatorId: user.id },
    { assigneeId: user.id },
    { reviewerId: user.id },
    { assignments: { some: { userId: user.id } } },
    { watchers: { some: { userId: user.id } } },
  ];

  // onlyMine wins over explicit assigneeId
  if (filter.onlyMine) {
    where.assigneeId = user.id;
  } else if (filter.assigneeId) {
    where.assigneeId = filter.assigneeId;
  }

  if (filter.priority) where.priority = filter.priority;
  if (filter.q) {
    where.OR = [
      { title: { contains: filter.q, mode: 'insensitive' } },
      { description: { contains: filter.q, mode: 'insensitive' } },
    ];
  }
  if (filter.tagIds && filter.tagIds.length > 0) {
    // AND-semantics: task must carry every selected tag. Done with one
    // AND-array of relation filters so Prisma stays in a single query.
    where.AND = filter.tagIds.map((tagId) => ({
      taskTags: { some: { tagId } },
    }));
  }

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
      priority: true,
      type: true,
      estimateHours: true,
      tags: true,
      externalSource: true,
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
        }))
      : DEFAULT_BOARD_COLUMNS.map((c, i) => ({
          id: `default-${c.status}`,
          name: c.name,
          status: c.status,
          order: i,
          wipLimit: null,
        }));
  const columns: BoardColumnView[] = baseCols.map((c) => ({
    ...c,
    wipLimit: c.wipLimit ?? wipJson?.[c.status] ?? null,
  }));

  return { project, tasks, columns };
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
