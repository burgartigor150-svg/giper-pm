-- Knowledge Base article templates (account + space scope). Additive + idempotent.
DO $$ BEGIN
  CREATE TYPE "KnowledgeTemplateScope" AS ENUM ('ACCOUNT', 'SPACE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "KnowledgeTemplate" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "icon" TEXT,
  "scope" "KnowledgeTemplateScope" NOT NULL DEFAULT 'ACCOUNT',
  "spaceId" TEXT,
  "content" TEXT NOT NULL DEFAULT '',
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeTemplate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "KnowledgeTemplate_scope_spaceId_order_idx" ON "KnowledgeTemplate"("scope","spaceId","order");
DO $$ BEGIN
  ALTER TABLE "KnowledgeTemplate" ADD CONSTRAINT "KnowledgeTemplate_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "KnowledgeSpace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
