import type { PrismaClient, StatusCategory } from '@giper/db';

/**
 * Status-category semantics. Code reasons about CATEGORIES (a small fixed enum
 * mirroring the legacy TaskStatus); users create STATUSES (rows in the per-project
 * Status table). This is the single chokepoint the later slices route through so
 * done-detection, the Bitrix/Kaiten bridge, and reports stay category-based as
 * statuses become dynamic.
 *
 * Introduced in S1 (inert) — only the pure predicates + STATUS_SEED are used yet
 * (by the backfill). The DB helpers below land here ready for S2/S4.
 */

export const STATUS_CATEGORIES = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'REVIEW',
  'BLOCKED',
  'DONE',
  'CANCELED',
] as const satisfies readonly StatusCategory[];

/** Terminal (closed) categories — excluded from "open task" queries. */
export const TERMINAL_CATEGORIES: readonly StatusCategory[] = ['DONE', 'CANCELED'];

export const isTerminal = (c: StatusCategory): boolean => c === 'DONE' || c === 'CANCELED';
/** DONE demands an итог at close; CANCELED is the no-итог escape hatch. */
export const isClosing = (c: StatusCategory): boolean => c === 'DONE';
export const isCanceled = (c: StatusCategory): boolean => c === 'CANCELED';
export const isInProgress = (c: StatusCategory): boolean => c === 'IN_PROGRESS';
export const isReview = (c: StatusCategory): boolean => c === 'REVIEW';

/**
 * Resolve the default Status for a (project, category): the row flagged
 * isDefault, else the lowest-order non-archived one. The target for createTask,
 * Bitrix/Kaiten inbound, and auto-transitions once those are category-based.
 * Throws a typed error if a project has no status in the category (a guard in
 * S7 prevents removing the last one).
 */
export async function defaultStatusForCategory(
  db: Pick<PrismaClient, 'status'>,
  projectId: string,
  category: StatusCategory,
): Promise<{ id: string }> {
  const s = await db.status.findFirst({
    where: { projectId, category, archivedAt: null },
    orderBy: [{ isDefault: 'desc' }, { order: 'asc' }],
    select: { id: true },
  });
  if (!s) {
    throw new Error(`Нет статуса категории ${category} в проекте ${projectId}`);
  }
  return s;
}
