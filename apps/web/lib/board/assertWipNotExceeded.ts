import { prisma, type TaskStatus } from '@giper/db';
import { DomainError } from '../errors';

/**
 * Enforce a column's WIP limit server-side when a card ENTERS it. The board
 * shows/blocks WIP client-side, but the card-detail status picker, the MCP
 * server, and any other caller of the status core would otherwise bypass it —
 * so the limit only really holds if the core checks too.
 *
 * The effective limit is resolved exactly like listTasksForBoard: a column's own
 * `wipLimit` wins, else the legacy per-status `Project.wipLimits` JSON. The count
 * is the cards currently in the target (excluding the one being moved, and
 * CANCELED which the board hides). A CANCELED target is never limited.
 *
 * Throws DomainError('WIP_EXCEEDED', 409) when the target is already full. Call
 * only when the card is actually CHANGING column/status (entering a new target).
 *
 * BEST-EFFORT by design: the count and the subsequent write are not one atomic
 * transaction, so two exactly-concurrent moves into the same near-full column
 * can both pass and overshoot the limit by one. WIP is a soft, advisory control
 * (as in Kaiten) — a rare one-card overshoot is acceptable and self-corrects;
 * the point of this server check is to close the bypass via the card picker /
 * MCP, not to be a hard transactional gate.
 *
 * INTENTIONAL bypasses (these write status directly, not via the status core):
 * Bitrix/Kaiten inbound sync, the column re-type cascade, and the auto-move
 * transitions in autoTransitions.ts (starting a timer / logging hours must never
 * be blocked because a column is full).
 */
export async function assertWipNotExceeded(
  projectId: string,
  target: { columnId: string | null; status: TaskStatus },
  movingTaskId: string,
): Promise<void> {
  if (target.status === 'CANCELED') return; // no WIP on cancel (hidden column)

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { wipLimits: true },
  });
  const wipJson = (project?.wipLimits ?? null) as Partial<Record<TaskStatus, number>> | null;

  let limit: number | null;
  let count: number;

  if (target.columnId) {
    // Free-form / materialized column: limit is the column's own, else the
    // legacy per-status fallback; count the cards in THIS column.
    const col = await prisma.boardColumn.findUnique({
      where: { id: target.columnId },
      select: { wipLimit: true, status: true },
    });
    limit = col?.wipLimit ?? (col ? wipJson?.[col.status] ?? null : null);
    count = await prisma.task.count({
      where: { columnId: target.columnId, id: { not: movingTaskId }, internalStatus: { not: 'CANCELED' } },
    });
  } else {
    // Legacy / non-free-form (status → column 1:1): per-status limit + count.
    limit = wipJson?.[target.status] ?? null;
    count = await prisma.task.count({
      where: { projectId, internalStatus: target.status, id: { not: movingTaskId } },
    });
  }

  if (limit != null && count >= limit) {
    throw new DomainError('WIP_EXCEEDED', 409, `Колонка заполнена (WIP-лимит ${limit})`);
  }
}
