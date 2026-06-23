-- Knowledge Base smart tables (typed columns + rows). Additive + idempotent.
DO $$ BEGIN
  CREATE TYPE "KnowledgeColumnType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'CHECKBOX', 'SELECT', 'URL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "KnowledgeTable" (
  "id" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT 'Новая таблица',
  "icon" TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeTable_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "KnowledgeTable_spaceId_order_idx" ON "KnowledgeTable"("spaceId","order");
DO $$ BEGIN
  ALTER TABLE "KnowledgeTable" ADD CONSTRAINT "KnowledgeTable_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "KnowledgeSpace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "KnowledgeTableColumn" (
  "id" TEXT NOT NULL,
  "tableId" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT 'Столбец',
  "type" "KnowledgeColumnType" NOT NULL DEFAULT 'TEXT',
  "options" JSONB,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeTableColumn_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "KnowledgeTableColumn_tableId_order_idx" ON "KnowledgeTableColumn"("tableId","order");
DO $$ BEGIN
  ALTER TABLE "KnowledgeTableColumn" ADD CONSTRAINT "KnowledgeTableColumn_tableId_fkey"
    FOREIGN KEY ("tableId") REFERENCES "KnowledgeTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "KnowledgeTableRow" (
  "id" TEXT NOT NULL,
  "tableId" TEXT NOT NULL,
  "values" JSONB NOT NULL DEFAULT '{}',
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeTableRow_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "KnowledgeTableRow_tableId_order_idx" ON "KnowledgeTableRow"("tableId","order");
DO $$ BEGIN
  ALTER TABLE "KnowledgeTableRow" ADD CONSTRAINT "KnowledgeTableRow_tableId_fkey"
    FOREIGN KEY ("tableId") REFERENCES "KnowledgeTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
