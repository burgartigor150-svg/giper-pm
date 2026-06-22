-- Knowledge Base essentials: article draft/published status + favorites.
-- Additive + idempotent.

-- Article status enum + column (default PUBLISHED so existing rows stay visible).
DO $$ BEGIN
  CREATE TYPE "KnowledgeArticleStatus" AS ENUM ('DRAFT', 'PUBLISHED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "KnowledgeArticle"
  ADD COLUMN IF NOT EXISTS "status" "KnowledgeArticleStatus" NOT NULL DEFAULT 'PUBLISHED';

CREATE INDEX IF NOT EXISTS "KnowledgeArticle_status_idx" ON "KnowledgeArticle"("status");

-- Favorites: a user's starred space or article.
CREATE TABLE IF NOT EXISTS "KnowledgeFavorite" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "spaceId" TEXT,
  "articleId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeFavorite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeFavorite_userId_spaceId_key" ON "KnowledgeFavorite"("userId","spaceId");
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeFavorite_userId_articleId_key" ON "KnowledgeFavorite"("userId","articleId");
CREATE INDEX IF NOT EXISTS "KnowledgeFavorite_userId_idx" ON "KnowledgeFavorite"("userId");
DO $$ BEGIN
  ALTER TABLE "KnowledgeFavorite" ADD CONSTRAINT "KnowledgeFavorite_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "KnowledgeSpace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "KnowledgeFavorite" ADD CONSTRAINT "KnowledgeFavorite_articleId_fkey"
    FOREIGN KEY ("articleId") REFERENCES "KnowledgeArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
