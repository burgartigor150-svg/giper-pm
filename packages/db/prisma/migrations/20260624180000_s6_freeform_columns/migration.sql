-- S6 free-form board columns. Drop the 1:1 (projectId,status) UNIQUE on
-- BoardColumn so multiple columns can share a status category, replace it with a
-- plain index for the status→column fallback lookup, and add the per-project
-- opt-in flag. Additive + idempotent.

-- Drop the old 1:1 unique. Prisma materialized @@unique([projectId,status]) as a
-- bare UNIQUE INDEX (see 20260618120000_kaiten_board_columns: CREATE UNIQUE INDEX
-- "BoardColumn_projectId_status_key"), NOT a table constraint — so DROP INDEX is
-- what actually removes it under `migrate deploy` (DROP CONSTRAINT would no-op).
-- Keep the DROP CONSTRAINT too as belt-and-suspenders for any env where it is one.
ALTER TABLE "BoardColumn" DROP CONSTRAINT IF EXISTS "BoardColumn_projectId_status_key";
DROP INDEX IF EXISTS "BoardColumn_projectId_status_key";
-- Non-unique index keeps the status→column fallback lookup fast.
CREATE INDEX IF NOT EXISTS "BoardColumn_projectId_status_idx" ON "BoardColumn"("projectId", "status");

-- Per-project opt-in for the free-form column-management UI.
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "freeFormColumnsEnabled" BOOLEAN NOT NULL DEFAULT false;
