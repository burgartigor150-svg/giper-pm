-- Knowledge Base article approval workflow. Additive + idempotent.
DO $$ BEGIN
  CREATE TYPE "KnowledgeReviewState" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "KnowledgeArticleReview" (
  "id" TEXT NOT NULL,
  "articleId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "reviewerId" TEXT NOT NULL,
  "state" "KnowledgeReviewState" NOT NULL DEFAULT 'PENDING',
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "KnowledgeArticleReview_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "KnowledgeArticleReview_articleId_createdAt_idx" ON "KnowledgeArticleReview"("articleId","createdAt");
CREATE INDEX IF NOT EXISTS "KnowledgeArticleReview_reviewerId_state_idx" ON "KnowledgeArticleReview"("reviewerId","state");
DO $$ BEGIN
  ALTER TABLE "KnowledgeArticleReview" ADD CONSTRAINT "KnowledgeArticleReview_articleId_fkey"
    FOREIGN KEY ("articleId") REFERENCES "KnowledgeArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
