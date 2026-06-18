import { prisma, type TaskStatus } from '@giper/db';
import {
  DEFAULT_BOARD_COLUMNS,
  type BoardColumnView,
} from '../tasks/listTasksForBoard';

/**
 * Load a project's board columns for management/editing: the first-class
 * BoardColumn rows (CANCELED excluded — the board hides cancelled work) ordered
 * left→right, or the synthesized default set for a project that has none yet.
 * Each column's WIP resolves from its own `wipLimit`, falling back to the legacy
 * per-status `wipLimits` JSON so the editor shows the limit actually in effect.
 *
 * Fault-tolerant: a missing BoardColumn table (deploy→migrate window) falls back
 * to defaults rather than throwing.
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

  let dbCols: BoardColumnView[] = [];
  try {
    dbCols = await prisma.boardColumn.findMany({
      where: { projectId, status: { not: 'CANCELED' } },
      orderBy: { order: 'asc' },
      select: { id: true, name: true, status: true, order: true, wipLimit: true },
    });
  } catch {
    dbCols = [];
  }

  const base: BoardColumnView[] =
    dbCols.length > 0
      ? dbCols
      : DEFAULT_BOARD_COLUMNS.map((c, i) => ({
          id: `default-${c.status}`,
          name: c.name,
          status: c.status,
          order: i,
          wipLimit: null,
        }));

  return base.map((c) => ({
    ...c,
    wipLimit: c.wipLimit ?? wipJson?.[c.status] ?? null,
  }));
}
