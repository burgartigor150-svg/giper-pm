-- Knowledge Base article version history. Additive + idempotent.
CREATE TABLE IF NOT EXISTS "KnowledgeArticleVersion" (
  "id" TEXT NOT NULL,
  "articleId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "icon" TEXT,
  "editedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeArticleVersion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "KnowledgeArticleVersion_articleId_createdAt_idx" ON "KnowledgeArticleVersion"("articleId","createdAt");
DO $$ BEGIN
  ALTER TABLE "KnowledgeArticleVersion" ADD CONSTRAINT "KnowledgeArticleVersion_articleId_fkey"
    FOREIGN KEY ("articleId") REFERENCES "KnowledgeArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
