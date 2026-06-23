-- Knowledge Base article comments + reactions. Additive + idempotent.
CREATE TABLE IF NOT EXISTS "KnowledgeComment" (
  "id" TEXT NOT NULL,
  "articleId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "parentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeComment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "KnowledgeComment_articleId_createdAt_idx" ON "KnowledgeComment"("articleId","createdAt");
DO $$ BEGIN
  ALTER TABLE "KnowledgeComment" ADD CONSTRAINT "KnowledgeComment_articleId_fkey"
    FOREIGN KEY ("articleId") REFERENCES "KnowledgeArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "KnowledgeComment" ADD CONSTRAINT "KnowledgeComment_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "KnowledgeComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "KnowledgeReaction" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "emoji" TEXT NOT NULL,
  "articleId" TEXT,
  "commentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeReaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeReaction_userId_articleId_emoji_key" ON "KnowledgeReaction"("userId","articleId","emoji");
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeReaction_userId_commentId_emoji_key" ON "KnowledgeReaction"("userId","commentId","emoji");
CREATE INDEX IF NOT EXISTS "KnowledgeReaction_articleId_idx" ON "KnowledgeReaction"("articleId");
CREATE INDEX IF NOT EXISTS "KnowledgeReaction_commentId_idx" ON "KnowledgeReaction"("commentId");
DO $$ BEGIN
  ALTER TABLE "KnowledgeReaction" ADD CONSTRAINT "KnowledgeReaction_articleId_fkey"
    FOREIGN KEY ("articleId") REFERENCES "KnowledgeArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "KnowledgeReaction" ADD CONSTRAINT "KnowledgeReaction_commentId_fkey"
    FOREIGN KEY ("commentId") REFERENCES "KnowledgeComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
