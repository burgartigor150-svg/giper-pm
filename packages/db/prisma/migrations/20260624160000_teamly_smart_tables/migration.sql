-- TEAMLY smart-table import (T3): mirror provenance on the KnowledgeTable models
-- so a re-sync upserts tables/columns/rows in place (and keeps stable local
-- column ids that row values key on). Additive + idempotent.

-- KnowledgeTable: externalId = the TEAMLY space id (a table IS a space).
ALTER TABLE "KnowledgeTable" ADD COLUMN IF NOT EXISTS "externalSource" TEXT;
ALTER TABLE "KnowledgeTable" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE "KnowledgeTable" ADD COLUMN IF NOT EXISTS "externalUpdatedAt" TIMESTAMP(3);
-- NULLs are distinct in Postgres, so native (NULL externalId) rows never collide.
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeTable_externalSource_externalId_key"
  ON "KnowledgeTable"("externalSource", "externalId");

-- KnowledgeTableColumn: externalId = the TEAMLY property id.
ALTER TABLE "KnowledgeTableColumn" ADD COLUMN IF NOT EXISTS "externalSource" TEXT;
ALTER TABLE "KnowledgeTableColumn" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeTableColumn_externalSource_externalId_key"
  ON "KnowledgeTableColumn"("externalSource", "externalId");

-- KnowledgeTableRow: externalId = the TEAMLY row-article id.
ALTER TABLE "KnowledgeTableRow" ADD COLUMN IF NOT EXISTS "externalSource" TEXT;
ALTER TABLE "KnowledgeTableRow" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeTableRow_externalSource_externalId_key"
  ON "KnowledgeTableRow"("externalSource", "externalId");
