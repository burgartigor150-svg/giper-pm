import type { PrismaClient, StatusCategory } from '@giper/db';

/**
 * Seed + backfill for the dynamic Status table (S1, Phase M1–M3). The canonical
 * SQL lives in the prod migration (idempotent); this TS mirror exists so CI
 * (which uses `prisma db push`, not migration files) and any dev/seed path can
 * materialize the same state, and so integration tests can invoke it directly.
 *
 * Deterministic ids `st_<projectId>_<CATEGORY>` make every step re-runnable.
 */

/** The 7 seed statuses per project — names/colors match the legacy board look. */
export const STATUS_SEED: ReadonlyArray<{
  category: StatusCategory;
  name: string;
  order: number;
  color: string;
}> = [
  { category: 'BACKLOG', name: 'Бэклог', order: 0, color: '#94a3b8' },
  { category: 'TODO', name: 'К выполнению', order: 1, color: '#60a5fa' },
  { category: 'IN_PROGRESS', name: 'В работе', order: 2, color: '#fbbf24' },
  { category: 'REVIEW', name: 'На проверке', order: 3, color: '#a78bfa' },
  { category: 'BLOCKED', name: 'Заблокировано', order: 4, color: '#f87171' },
  { category: 'DONE', name: 'Готово', order: 5, color: '#34d399' },
  { category: 'CANCELED', name: 'Отменено', order: 6, color: '#6b7280' },
];

export const statusSeedId = (projectId: string, category: string): string =>
  `st_${projectId}_${category}`;

/** M1: seed the 7 statuses for one project (idempotent via skipDuplicates). */
export async function seedProjectStatuses(
  db: Pick<PrismaClient, 'status'>,
  projectId: string,
): Promise<void> {
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
 * Full backfill: seed every project's statuses, then point Task and BoardColumn
 * FKs at the seeded rows. The FK assignment is raw SQL because Prisma can't set
 * a column from an expression over another column. Idempotent (only NULL FKs).
 */
export async function backfillAllStatuses(
  db: Pick<PrismaClient, 'project' | 'status' | '$executeRawUnsafe'>,
): Promise<void> {
  const projects = await db.project.findMany({ select: { id: true } });
  for (const p of projects) await seedProjectStatuses(db, p.id);

  // M2: Task mirror + internal status FKs from the enum tracks.
  await db.$executeRawUnsafe(
    `UPDATE "Task" SET "statusId" = 'st_' || "projectId" || '_' || "status"::text WHERE "statusId" IS NULL`,
  );
  await db.$executeRawUnsafe(
    `UPDATE "Task" SET "internalStatusId" = 'st_' || "projectId" || '_' || "internalStatus"::text WHERE "internalStatusId" IS NULL`,
  );
  // M3: existing BoardColumn rows → their seeded status.
  await db.$executeRawUnsafe(
    `UPDATE "BoardColumn" SET "statusId" = 'st_' || "projectId" || '_' || "status"::text WHERE "statusId" IS NULL`,
  );
}
