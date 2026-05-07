-- Two-way sync bookkeeping on Task.
ALTER TABLE "Task" ADD COLUMN "bitrixSyncedAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN "bitrixSyncedHash" TEXT;
ALTER TABLE "Task" ADD COLUMN "syncConflict" BOOLEAN NOT NULL DEFAULT false;

-- Comment visibility (EXTERNAL = pushed to Bitrix, INTERNAL = local only).
CREATE TYPE "CommentVisibility" AS ENUM ('EXTERNAL', 'INTERNAL');
ALTER TABLE "Comment" ADD COLUMN "visibility" "CommentVisibility" NOT NULL DEFAULT 'EXTERNAL';

-- Outbound bookkeeping for Comment (track Bitrix-side comment id we created).
ALTER TABLE "Comment" ADD COLUMN "externalId" TEXT;
ALTER TABLE "Comment" ADD COLUMN "externalSource" TEXT;
CREATE UNIQUE INDEX "Comment_externalSource_externalId_key" ON "Comment"("externalSource", "externalId");
