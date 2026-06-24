import type { PrismaClient, TaskStatus } from '@giper/db';
import { statusSeedId } from '@giper/shared';

type ColumnDb = Pick<PrismaClient, 'boardColumn'>;

/**
 * Dual-write FK helpers (S2). Every place that writes a task's enum status also
 * writes the matching FKs so the new tracks stay current before S3 flips the
 * board onto them. `statusId`/`internalStatusId` are deterministic (no query);
 * `columnId` (board placement, driven by the INTERNAL status) needs a lookup.
 */

/**
 * The board column a card with the given internal status sits in for this
 * project — the lowest-order column for that status. Null only if the project
 * has no materialized column for it (e.g. CANCELED, which the board hides; S2
 * materializes the 6 visible columns for every project + on create).
 */
export async function boardColumnIdForStatus(
  db: ColumnDb,
  projectId: string,
  status: TaskStatus,
): Promise<string | null> {
  const col = await db.boardColumn.findFirst({
    where: { projectId, status },
    orderBy: { order: 'asc' },
    select: { id: true },
  });
  return col?.id ?? null;
}

/**
 * Dual-write fields for a task whose INTERNAL status is `status`:
 * internalStatusId (deterministic) + columnId (looked up). Spread into a prisma
 * task create/update alongside the existing `internalStatus` write.
 */
export async function internalStatusWrite(
  db: ColumnDb,
  projectId: string,
  status: TaskStatus,
): Promise<{ internalStatusId: string; columnId: string | null }> {
  return {
    internalStatusId: statusSeedId(projectId, status),
    columnId: await boardColumnIdForStatus(db, projectId, status),
  };
}

/** Dual-write field for the MIRROR status track (deterministic, no query). */
export function mirrorStatusWrite(projectId: string, status: TaskStatus): { statusId: string } {
  return { statusId: statusSeedId(projectId, status) };
}
