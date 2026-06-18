import { prisma, type TaskStatus } from '@giper/db';
import {
  DEFAULT_BOARD_COLUMNS,
  type BoardColumnView,
  type BoardSubColumnView,
} from '../tasks/listTasksForBoard';

/**
 * Load a project's board columns for management/editing: the first-class
 * BoardColumn rows (CANCELED excluded) ordered left→right, with their
 * sub-columns attached, or the synthesized default set for a project with none.
 * Each column's WIP resolves from its own wipLimit, falling back to the legacy
 * per-status `wipLimits` JSON. Fault-tolerant: missing tables fall back to []/defaults.
 */
export async function getBoardColumns(
  projectId: string,
): Promise<BoardColumnView[]> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { wipLimits: true },
  });
  const wipJson = (project?.wipLimits ?? null) as Partial<
    Record<TaskStatus, number>
  > | null;

  let dbCols: Array<{
    id: string;
    name: string;
    status: TaskStatus;
    order: number;
    wipLimit: number | null;
  }> = [];
  try {
    dbCols = await prisma.boardColumn.findMany({
      where: { projectId, status: { not: 'CANCELED' } },
      orderBy: { order: 'asc' },
      select: { id: true, name: true, status: true, order: true, wipLimit: true },
    });
  } catch {
    dbCols = [];
  }

  // Sub-columns grouped under their parent column (fault-tolerant).
  const subsByCol = new Map<string, BoardSubColumnView[]>();
  try {
    const subs = await prisma.boardSubColumn.findMany({
      where: { column: { projectId } },
      orderBy: { order: 'asc' },
      select: { id: true, columnId: true, name: true, order: true, wipLimit: true },
    });
    for (const s of subs) {
      const arr = subsByCol.get(s.columnId);
      if (arr) arr.push(s);
      else subsByCol.set(s.columnId, [s]);
    }
  } catch {
    // table may not exist yet during the deploy→migrate window
  }

  const base: BoardColumnView[] =
    dbCols.length > 0
      ? dbCols.map((c) => ({ ...c, subColumns: subsByCol.get(c.id) ?? [] }))
      : DEFAULT_BOARD_COLUMNS.map((c, i) => ({
          id: `default-${c.status}`,
          name: c.name,
          status: c.status,
          order: i,
          wipLimit: null,
          subColumns: [],
        }));

  return base.map((c) => ({
    ...c,
    wipLimit: c.wipLimit ?? wipJson?.[c.status] ?? null,
  }));
}
