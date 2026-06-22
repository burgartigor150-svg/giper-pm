-- Figma designs linked to tasks. Additive + idempotent (safe under migrate
-- deploy and db push).
CREATE TABLE IF NOT EXISTS "TaskDesign" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'figma',
  "url" TEXT NOT NULL,
  "fileKey" TEXT NOT NULL,
  "nodeId" TEXT,
  "title" TEXT NOT NULL,
  "thumbnailUrl" TEXT,
  "addedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaskDesign_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "TaskDesign" ADD CONSTRAINT "TaskDesign_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "TaskDesign_taskId_url_key" ON "TaskDesign"("taskId", "url");
CREATE INDEX IF NOT EXISTS "TaskDesign_taskId_idx" ON "TaskDesign"("taskId");
CREATE INDEX IF NOT EXISTS "TaskDesign_fileKey_idx" ON "TaskDesign"("fileKey");
