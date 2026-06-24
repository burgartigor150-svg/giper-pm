import type { PrismaClient, StatusCategory, TaskStatus } from '@giper/db';
import { statusSeedId } from '@giper/shared';

/**
 * Dynamic-status (S1) support for the integration inbound paths. Bitrix/Kaiten
 * write the legacy enum `status`; S5 dual-writes the matching Status-table FKs so
 * a mirrored task carries the same `statusId`/`internalStatusId`/`columnId` an
 * app-created task gets (kept consistent for S6 free-form columns + S10).
 *
 * `packages/integrations` can't import `apps/web/lib/status`, but it CAN import
 * `statusSeedId` from `@giper/shared` and prisma from `@giper/db` — so the seed
 * + FK helpers live here, mirroring `apps/web/lib/status/backfillStatuses.ts`
 * (same deterministic ids `st_<projectId>_<CATEGORY>`).
 */

/** 7 seed statuses per project — MUST match apps/web STATUS_SEED (names/colors). */
const STATUS_SEED: ReadonlyArray<{ category: StatusCategory; name: string; order: number; color: string }> = [
  { category: 'BACKLOG', name: 'Бэклог', order: 0, color: '#94a3b8' },
  { category: 'TODO', name: 'К выполнению', order: 1, color: '#60a5fa' },
  { category: 'IN_PROGRESS', name: 'В работе', order: 2, color: '#fbbf24' },
  { category: 'REVIEW', name: 'На проверке', order: 3, color: '#a78bfa' },
  { category: 'BLOCKED', name: 'Заблокировано', order: 4, color: '#f87171' },
  { category: 'DONE', name: 'Готово', order: 5, color: '#34d399' },
  { category: 'CANCELED', name: 'Отменено', order: 6, color: '#6b7280' },
];

/**
 * Seed the 7 dynamic statuses for a project (idempotent via skipDuplicates).
 * Bitrix creates projects directly (syncProjects/syncTasks) — without this their
 * mirrored tasks' status FKs would dangle (and break the FK-enforcing CI/e2e DB).
 */
export async function seedProjectStatuses(db: Pick<PrismaClient, 'status'>, projectId: string): Promise<void> {
  await db.status.createMany({
    data: STATUS_SEED.map((s) => ({
      id: statusSeedId(projectId, s.category),
      projectId,
      name: s.name,
      category: s.category,
      order: s.order,
      color: s.color,
      isDefault: true,
    })),
    skipDuplicates: true,
  });
}

/**
 * Bulk self-heal — seed statuses for MANY projects in one idempotent createMany.
 * Bitrix projects created between the S1 backfill and the S5 deploy have no
 * statuses; calling this at the top of a sync run ensures the dual-write FKs
 * resolve instead of dangling, without N per-project round-trips.
 */
export async function seedProjectsStatuses(
  db: Pick<PrismaClient, 'status'>,
  projectIds: readonly string[],
): Promise<void> {
  if (projectIds.length === 0) return;
  await db.status.createMany({
    data: projectIds.flatMap((projectId) =>
      STATUS_SEED.map((s) => ({
        id: statusSeedId(projectId, s.category),
        projectId,
        name: s.name,
        category: s.category,
        order: s.order,
        color: s.color,
        isDefault: true,
      })),
    ),
    skipDuplicates: true,
  });
}

/** Mirror-track FK — Bitrix/Kaiten write the mirror `status`. Pure (deterministic id). */
export function mirrorStatusFk(projectId: string, status: TaskStatus): { statusId: string } {
  return { statusId: statusSeedId(projectId, status) };
}

/**
 * Internal-track FKs — the board placement a newly-mirrored task starts in
 * (its `internalStatus`, which defaults to BACKLOG on these inbound creates).
 * Resolves the matching BoardColumn (null when the project has none / the board
 * synthesizes defaults — the S3 read falls back to the status bucket then).
 */
export async function internalStatusFk(
  db: Pick<PrismaClient, 'boardColumn'>,
  projectId: string,
  status: TaskStatus,
): Promise<{ internalStatusId: string; columnId: string | null }> {
  const col = await db.boardColumn.findFirst({
    where: { projectId, status },
    orderBy: { order: 'asc' },
    select: { id: true },
  });
  return { internalStatusId: statusSeedId(projectId, status), columnId: col?.id ?? null };
}
