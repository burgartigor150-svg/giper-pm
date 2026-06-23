-- Knowledge Base per-space access: visibility + members. Additive + idempotent.
DO $$ BEGIN
  CREATE TYPE "KnowledgeSpaceVisibility" AS ENUM ('PUBLIC', 'PRIVATE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "KnowledgeSpaceRole" AS ENUM ('EDITOR', 'MANAGER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "KnowledgeSpace"
  ADD COLUMN IF NOT EXISTS "visibility" "KnowledgeSpaceVisibility" NOT NULL DEFAULT 'PUBLIC';

CREATE TABLE IF NOT EXISTS "KnowledgeSpaceMember" (
  "id" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "KnowledgeSpaceRole" NOT NULL DEFAULT 'EDITOR',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeSpaceMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeSpaceMember_spaceId_userId_key" ON "KnowledgeSpaceMember"("spaceId","userId");
CREATE INDEX IF NOT EXISTS "KnowledgeSpaceMember_userId_idx" ON "KnowledgeSpaceMember"("userId");
DO $$ BEGIN
  ALTER TABLE "KnowledgeSpaceMember" ADD CONSTRAINT "KnowledgeSpaceMember_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "KnowledgeSpace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
