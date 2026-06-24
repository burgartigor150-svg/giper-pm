-- S1 — dynamic Status table (expand phase, INERT). Additive + idempotent.
-- The Task/BoardColumn → Status FK constraints are DEFERRED to the contract
-- slice (S10, NOT VALID → VALIDATE); here we only add the table, columns,
-- indexes, and seed/backfill so nothing in the expand phase can be blocked by
-- validation against existing rows. The legacy TaskStatus enum + Task.status /
-- Task.internalStatus columns stay as the denormalized category mirror.

-- 1. StatusCategory enum (7 values, mirrors TaskStatus).
DO $$ BEGIN
  CREATE TYPE "StatusCategory" AS ENUM
    ('BACKLOG','TODO','IN_PROGRESS','REVIEW','BLOCKED','DONE','CANCELED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Status table + its FK to Project (new table → empty → safe to constrain).
CREATE TABLE IF NOT EXISTS "Status" (
  "id"         TEXT PRIMARY KEY,
  "projectId"  TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "category"   "StatusCategory" NOT NULL,
  "color"      TEXT,
  "order"      INTEGER NOT NULL DEFAULT 0,
  "isDefault"  BOOLEAN NOT NULL DEFAULT false,
  "archivedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE "Status" ADD CONSTRAINT "Status_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "Status_projectId_name_key"     ON "Status"("projectId","name");
CREATE INDEX        IF NOT EXISTS "Status_projectId_order_idx"    ON "Status"("projectId","order");
CREATE INDEX        IF NOT EXISTS "Status_projectId_category_idx" ON "Status"("projectId","category");

-- 3. FK columns (no constraints yet) + indexes.
ALTER TABLE "Task"        ADD COLUMN IF NOT EXISTS "statusId" TEXT;
ALTER TABLE "Task"        ADD COLUMN IF NOT EXISTS "internalStatusId" TEXT;
ALTER TABLE "BoardColumn" ADD COLUMN IF NOT EXISTS "statusId" TEXT;
ALTER TABLE "BoardColumn" ADD COLUMN IF NOT EXISTS "color" TEXT;
CREATE INDEX IF NOT EXISTS "Task_projectId_internalStatusId_idx" ON "Task"("projectId","internalStatusId");
CREATE INDEX IF NOT EXISTS "BoardColumn_projectId_statusId_idx"  ON "BoardColumn"("projectId","statusId");

-- 4. M1 — seed 7 Status rows per project (deterministic ids → re-runnable).
INSERT INTO "Status" ("id","projectId","name","category","order","isDefault","color","createdAt","updatedAt")
SELECT 'st_'||p."id"||'_'||v.cat, p."id", v.label, v.cat::"StatusCategory", v.ord, true, v.color, now(), now()
FROM "Project" p CROSS JOIN (VALUES
  ('BACKLOG','Бэклог',0,'#94a3b8'),
  ('TODO','К выполнению',1,'#60a5fa'),
  ('IN_PROGRESS','В работе',2,'#fbbf24'),
  ('REVIEW','На проверке',3,'#a78bfa'),
  ('BLOCKED','Заблокировано',4,'#f87171'),
  ('DONE','Готово',5,'#34d399'),
  ('CANCELED','Отменено',6,'#6b7280')
) AS v(cat,label,ord,color)
ON CONFLICT ("projectId","name") DO NOTHING;

-- 5. M2 — Task FKs from the enum tracks (idempotent; only NULLs).
UPDATE "Task" SET "statusId"         = 'st_'||"projectId"||'_'||"status"::text         WHERE "statusId" IS NULL;
UPDATE "Task" SET "internalStatusId" = 'st_'||"projectId"||'_'||"internalStatus"::text WHERE "internalStatusId" IS NULL;

-- 6. M3 — existing BoardColumn rows → their seeded status.
UPDATE "BoardColumn" SET "statusId" = 'st_'||"projectId"||'_'||"status"::text WHERE "statusId" IS NULL;
