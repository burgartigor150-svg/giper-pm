'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@giper/db';
import { taskStatusSchema } from '@giper/shared';
import { requireAuth } from '@/lib/auth';
import { setInternalStatus } from '@/lib/tasks/setInternalStatus';
import { moveTaskToColumn } from '@/lib/tasks/moveTaskToColumn';
import { DomainError } from '@/lib/errors';

/** Hard cap per batch — keeps one action from looping unbounded work. */
const MAX_BULK = 200;

// Closing categories are excluded from bulk move: this mirrors single-card DnD,
// which refuses closing moves (DONE needs an итог; CANCELED is a deliberate
// terminal decision). Close cards individually from the card view.
const nonClosingStatusSchema = taskStatusSchema.refine(
  (s) => s !== 'DONE' && s !== 'CANCELED',
  { message: 'Нельзя массово переместить в завершающую колонку — закройте карточки по одной' },
);

const boardMoveTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('status'), status: nonClosingStatusSchema }),
  z.object({ kind: z.literal('column'), columnId: z.string().min(1) }),
]);
export type BoardMoveTarget = z.infer<typeof boardMoveTargetSchema>;

type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

/**
 * Move many cards on the BOARD at once — to a target internalStatus
 * (status-keyed board) or to a specific column (free-form board).
 *
 * Unlike the list view's bulk 'status' op (which writes only the Bitrix-mirror
 * `status` and would leave cards visually in place), this drives the board's
 * OWN track via setInternalStatus / moveTaskToColumn — the SAME cores
 * single-card DnD uses. So per card the итог-on-DONE gate, WIP limit, transition
 * allowlist, auto-assign, column-enter automations, Bitrix push and parent
 * rollup all apply exactly as a manual drag would.
 *
 * Authorization is PER TASK (each id routed through the gated core, which
 * resolves the caller's effective caps internally). A task the caller can't move
 * — or a WIP-full / disallowed-transition / not-found target — is COUNTED as
 * failed and skipped; the batch never aborts and one forbidden task can never
 * affect another. Closing targets (DONE/CANCELED) are rejected at the boundary.
 * Returns a {succeeded, failed} tally.
 */
export async function bulkMoveTasksOnBoardAction(
  taskIds: string[],
  target: BoardMoveTarget,
): Promise<ActionResult<{ succeeded: number; failed: number }>> {
  const me = await requireAuth();

  const parsed = boardMoveTargetSchema.safeParse(target);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: 'VALIDATION', message: parsed.error.issues[0]?.message ?? 'Некорректная цель перемещения' },
    };
  }
  // A 'use server' action receives whatever the client POSTs — a non-array must
  // fail closed, not throw a TypeError.
  const idsParsed = z.array(z.string().min(1)).safeParse(taskIds);
  if (!idsParsed.success) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Некорректный список задач' } };
  }
  const ids = Array.from(new Set(idsParsed.data));
  if (ids.length === 0) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Не выбрано ни одной задачи' } };
  }
  if (ids.length > MAX_BULK) {
    return { ok: false, error: { code: 'VALIDATION', message: `Не более ${MAX_BULK} задач за раз` } };
  }

  const t = parsed.data;

  // Symmetry with the status target's closing-refine: a free-form column whose
  // category is DONE/CANCELED is a closing move too, and CANCELED would slip
  // past setInternalStatus (no итог required) and silently cancel the batch.
  // Reject closing columns at the boundary; an unknown columnId falls through so
  // the per-item loop counts it as failed (consistent with single-card DnD).
  if (t.kind === 'column') {
    const col = await prisma.boardColumn.findUnique({
      where: { id: t.columnId },
      select: { status: true },
    });
    if (col && (col.status === 'DONE' || col.status === 'CANCELED')) {
      return {
        ok: false,
        error: {
          code: 'VALIDATION',
          message: 'Нельзя массово переместить в завершающую колонку — закройте карточки по одной',
        },
      };
    }
  }

  let succeeded = 0;
  let failed = 0;

  for (const id of ids) {
    try {
      if (t.kind === 'status') {
        // skipWip defaults false → the per-card WIP limit is honored (a full
        // target column counts the overflow card as failed, not a hard abort).
        await setInternalStatus(id, t.status, me, {});
      } else {
        await moveTaskToColumn(id, t.columnId, me);
      }
      succeeded++;
    } catch (e) {
      failed++;
      // DomainError = an expected per-task rejection (perms / not-found /
      // transition / WIP / итог-on-DONE). Anything else is unexpected — log but
      // still don't abort.
      if (!(e instanceof DomainError)) {
        console.error('bulkMoveTasksOnBoardAction: item failed', id, e);
      }
    }
  }

  // The client router.refresh() updates the current board; revalidate the
  // broader projects tree so other cached board/list views reflect the change.
  revalidatePath('/projects', 'layout');
  return { ok: true, data: { succeeded, failed } };
}
