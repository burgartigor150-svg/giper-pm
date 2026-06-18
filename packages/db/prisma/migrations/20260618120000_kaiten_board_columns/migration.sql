-- Kaiten-style configurable board (Phase 0): first-class BoardColumn +
-- BoardSwimlane with per-column/lane WIP, and board-placement fields on Task.
-- Columns map 1:1 to the internal TaskStatus track to start, so reports, the
-- Bitrix mirror, and existing status logic keep working. Additive + backfilled
-- — no behaviour change yet (the board UI still renders the static columns
-- until Phase 0b rewires it to read BoardColumn).

-- CreateTable
CREATE TABLE "BoardColumn" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL,
    "order" INTEGER NOT NULL,
    "wipLimit" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardColumn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardSwimlane" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "wipLimit" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardSwimlane_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BoardColumn_projectId_status_key" ON "BoardColumn"("projectId", "status");
CREATE INDEX "BoardColumn_projectId_order_idx" ON "BoardColumn"("projectId", "order");
CREATE INDEX "BoardSwimlane_projectId_order_idx" ON "BoardSwimlane"("projectId", "order");

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "columnId" TEXT;
ALTER TABLE "Task" ADD COLUMN "swimlaneId" TEXT;
ALTER TABLE "Task" ADD COLUMN "boardRank" TEXT;

-- CreateIndex
CREATE INDEX "Task_columnId_swimlaneId_idx" ON "Task"("columnId", "swimlaneId");

-- AddForeignKey
ALTER TABLE "BoardColumn" ADD CONSTRAINT "BoardColumn_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BoardSwimlane" ADD CONSTRAINT "BoardSwimlane_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "BoardColumn"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_swimlaneId_fkey" FOREIGN KEY ("swimlaneId") REFERENCES "BoardSwimlane"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: seed one column per status for every existing project (Russian
-- labels matching the current static board), then point each task's columnId
-- at its project's column for the task's internalStatus.
INSERT INTO "BoardColumn" ("id", "projectId", "name", "status", "order", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    p."id",
    s."name",
    s."val"::"TaskStatus",
    s."ord",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Project" p
CROSS JOIN (VALUES
    ('Бэклог', 'BACKLOG', 0),
    ('К работе', 'TODO', 1),
    ('В работе', 'IN_PROGRESS', 2),
    ('На ревью', 'REVIEW', 3),
    ('Заблокирована', 'BLOCKED', 4),
    ('Готово', 'DONE', 5),
    ('Отменена', 'CANCELED', 6)
) AS s("name", "val", "ord");

UPDATE "Task" t
SET "columnId" = c."id"
FROM "BoardColumn" c
WHERE c."projectId" = t."projectId"
  AND c."status" = t."internalStatus";
