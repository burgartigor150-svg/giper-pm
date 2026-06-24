-- T4 — TEAMLY attachment provenance. Add external mirror columns to
-- KnowledgeAttachment so a re-sync dedupes instead of re-downloading the same
-- file. Additive + idempotent. The unique pair only constrains non-null rows
-- (Postgres treats NULLs as distinct), so user uploads (both null) are unaffected.
ALTER TABLE "KnowledgeAttachment" ADD COLUMN IF NOT EXISTS "externalSource" TEXT;
ALTER TABLE "KnowledgeAttachment" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeAttachment_externalSource_externalId_key"
  ON "KnowledgeAttachment"("externalSource", "externalId");
