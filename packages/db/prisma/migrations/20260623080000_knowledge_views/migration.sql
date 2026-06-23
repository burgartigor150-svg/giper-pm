-- Knowledge Base article view analytics. Additive + idempotent.
CREATE TABLE IF NOT EXISTS "KnowledgeArticleView" (
  "id" TEXT NOT NULL,
  "articleId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeArticleView_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeArticleView_articleId_userId_day_key" ON "KnowledgeArticleView"("articleId","userId","day");
CREATE INDEX IF NOT EXISTS "KnowledgeArticleView_articleId_idx" ON "KnowledgeArticleView"("articleId");
CREATE INDEX IF NOT EXISTS "KnowledgeArticleView_day_idx" ON "KnowledgeArticleView"("day");
DO $$ BEGIN
  ALTER TABLE "KnowledgeArticleView" ADD CONSTRAINT "KnowledgeArticleView_articleId_fkey"
    FOREIGN KEY ("articleId") REFERENCES "KnowledgeArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
