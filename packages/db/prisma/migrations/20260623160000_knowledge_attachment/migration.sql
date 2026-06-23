-- KB article file attachments. Additive + idempotent.
CREATE TABLE IF NOT EXISTS "KnowledgeAttachment" (
  "id" TEXT NOT NULL,
  "articleId" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL,
  "uploadedById" TEXT,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeAttachment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "KnowledgeAttachment_articleId_idx" ON "KnowledgeAttachment"("articleId");
DO $$ BEGIN
  ALTER TABLE "KnowledgeAttachment" ADD CONSTRAINT "KnowledgeAttachment_articleId_fkey"
    FOREIGN KEY ("articleId") REFERENCES "KnowledgeArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
