-- TEAMLY knowledge-base import: integration kind + mirror provenance columns.
-- Additive + idempotent.
ALTER TYPE "IntegrationKind" ADD VALUE IF NOT EXISTS 'TEAMLY';

ALTER TABLE "KnowledgeSpace" ADD COLUMN IF NOT EXISTS "externalSource" TEXT;
ALTER TABLE "KnowledgeSpace" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
-- NULLs are distinct in Postgres, so locally-created spaces (NULL externalId)
-- never collide; only one mirror row per (source, id).
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeSpace_externalSource_externalId_key"
  ON "KnowledgeSpace"("externalSource", "externalId");

ALTER TABLE "KnowledgeArticle" ADD COLUMN IF NOT EXISTS "externalSource" TEXT;
ALTER TABLE "KnowledgeArticle" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE "KnowledgeArticle" ADD COLUMN IF NOT EXISTS "externalUpdatedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeArticle_externalSource_externalId_key"
  ON "KnowledgeArticle"("externalSource", "externalId");
