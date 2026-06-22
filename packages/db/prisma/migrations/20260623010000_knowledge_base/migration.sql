-- Knowledge Base: spaces + article tree. Additive + idempotent.
CREATE TABLE IF NOT EXISTS "KnowledgeSpace" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "icon" TEXT,
  "color" TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,
  "archivedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeSpace_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "KnowledgeSpace_archivedAt_order_idx" ON "KnowledgeSpace"("archivedAt","order");

CREATE TABLE IF NOT EXISTS "KnowledgeArticle" (
  "id" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT 'Без названия',
  "content" TEXT NOT NULL DEFAULT '',
  "icon" TEXT,
  "parentId" TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeArticle_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "KnowledgeSpace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "KnowledgeArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "KnowledgeArticle_spaceId_parentId_order_idx" ON "KnowledgeArticle"("spaceId","parentId","order");
