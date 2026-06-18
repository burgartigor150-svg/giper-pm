import { prisma } from '@giper/db';
import type { BoardSwimlaneView } from '../tasks/listTasksForBoard';

/**
 * Load a project's board swimlanes (ordered). Empty = the board renders as a
 * single implicit lane. Fault-tolerant: a missing table falls back to [].
 */
export async function getBoardSwimlanes(
  projectId: string,
): Promise<BoardSwimlaneView[]> {
  try {
    return await prisma.boardSwimlane.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
      select: { id: true, name: true, order: true, wipLimit: true },
    });
  } catch {
    return [];
  }
}
