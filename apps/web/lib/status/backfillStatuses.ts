import type { PrismaClient, StatusCategory } from '@giper/db';
import { statusSeedId } from '@giper/shared';
import { DEFAULT_BOARD_COLUMNS } from '../board/defaultColumns';

export { statusSeedId };

/**
 * Seed + backfill for the dynamic Status table (S1 M1–M3) and the board-column
 * materialization + placement backfill (S2 M4–M5). The canonical SQL lives in
 * the prod migrations (idempotent); this TS mirror exists so CI (`prisma db
 * push`, not migration files) and any dev/seed path can materialize the same
 * state, and so integration tests can invoke it directly.
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
  { category: 'TESTING', name: 'Тестирование', order: 3, color: '#22d3ee' },
  { category: 'REVIEW', name: 'На проверке', order: 4, color: '#a78bfa' },
  { category: 'BLOCKED', name: 'Заблокировано', order: 5, color: '#f87171' },
  { category: 'DONE', name: 'Готово', order: 6, color: '#34d399' },
  { category: 'CANCELED', name: 'Отменено', order: 7, color: '#6b7280' },
];

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
 * M4: materialize the 6 default board columns for a project that has NONE
 * (idempotent — only fires at zero columns). Mirrors DEFAULT_BOARD_COLUMNS so
 * the board renders identically, with statusId linked. Projects that already
 * customised their columns keep them.
 */
export async function materializeProjectColumns(
  db: Pick<PrismaClient, 'boardColumn' | 'status'>,
  projectId: string,
): Promise<void> {
  const count = await db.boardColumn.count({ where: { projectId } });
  if (count > 0) return;
  // Columns carry a statusId FK → the project's statuses must exist first.
  // Seed defensively (idempotent) so this is safe to call standalone.
  await seedProjectStatuses(db, projectId);
  await db.boardColumn.createMany({
    data: DEFAULT_BOARD_COLUMNS.map((c, i) => ({
      projectId,
      name: c.name,
      status: c.status,
      statusId: statusSeedId(projectId, c.status),
      order: i,
    })),
    skipDuplicates: true,
  });
}

/**
 * Full backfill: seed statuses (M1) + materialize columns (M4) per project,
 * then point Task/BoardColumn FKs (M2/M3) and card placement (M5) at the
 * seeded rows. FK/placement assignment is raw SQL (Prisma can't set a column
 * from an expression over another column). All idempotent (only NULL targets).
 */
export async function backfillAllStatuses(
  db: Pick<PrismaClient, 'project' | 'status' | 'boardColumn' | '$executeRawUnsafe'>,
): Promise<void> {
  const projects = await db.project.findMany({ select: { id: true } });
  for (const p of projects) {
    await seedProjectStatuses(db, p.id); // M1
    await materializeProjectColumns(db, p.id); // M4
  }

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
  // M5: card placement → columnId (lowest-order column matching the INTERNAL
  // status). CANCELED tasks get no column (the board hides them) → stay null.
  await db.$executeRawUnsafe(
    `UPDATE "Task" t SET "columnId" = sub.cid
     FROM (SELECT DISTINCT ON (c."projectId", c."status") c."projectId", c."status", c."id" AS cid
           FROM "BoardColumn" c ORDER BY c."projectId", c."status", c."order") sub
     WHERE t."columnId" IS NULL AND sub."projectId" = t."projectId" AND sub."status" = t."internalStatus"`,
  );
}
