import { prisma } from '@giper/db';
import { isCanceled, statusCategory } from '../status/category';

/**
 * Per-COLUMN transition gate for free-form boards. Mirrors the invariant order
 * of {@link isTransitionAllowed} but at the column layer — it gates only
 * same-category column→column moves (cross-category moves stay on the category
 * engine):
 *   1. from===to → allowed (no-op).
 *   2. destination column is in the CANCELED category → always allowed (escape
 *      hatch; a card can always be cancelled).
 *   3. fromColumnId missing (null/undefined) → allowed (defensive: a stale/null
 *      columnId must never trap a card, mirroring the board's fail-open
 *      bucketing).
 *   4. ZERO rows for the project → allowed (the inert default).
 *   5. else allow only if a matching (fromColumnId,toColumnId) row exists.
 *
 * The category engine (isTransitionAllowed) is left byte-identical; this lives
 * in a separate function over a separate table.
 */
export async function isColumnTransitionAllowed(
  projectId: string,
  fromColumnId: string | null | undefined,
  toColumnId: string,
): Promise<boolean> {
  if (fromColumnId === toColumnId) return true;

  // Fail-open BEFORE any query: a null/undefined source column (a card never
  // placed, or pointing at a deleted column) must never be trapped.
  if (!fromColumnId) return true;

  // CANCELED escape hatch — a card can always move into a CANCELED-category
  // column. Defensive for direct callers: setTaskColumnAction only invokes this
  // on SAME-category moves (which never target the CANCELED category), but the
  // guard keeps the function safe for any future caller (e.g. a bulk-move API).
  const toCol = await prisma.boardColumn.findUnique({
    where: { id: toColumnId },
    select: { status: true },
  });
  if (toCol && isCanceled(statusCategory(toCol.status))) return true;

  const rows = await prisma.workflowColumnTransition.findMany({
    where: { projectId },
    select: { fromColumnId: true, toColumnId: true },
  });
  if (rows.length === 0) return true; // inert default
  return rows.some((r) => r.fromColumnId === fromColumnId && r.toColumnId === toColumnId);
}

/** A project's per-column transition edges (for the settings editor). */
export async function listWorkflowColumnTransitions(
  projectId: string,
): Promise<{ fromColumnId: string; toColumnId: string }[]> {
  try {
    return await prisma.workflowColumnTransition.findMany({
      where: { projectId },
      select: { fromColumnId: true, toColumnId: true },
    });
  } catch {
    return [];
  }
}
