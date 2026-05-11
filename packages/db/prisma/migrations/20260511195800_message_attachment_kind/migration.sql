-- MessageAttachment gets a kind discriminator + duration/dimensions
-- so we can store video-notes (round 480x480 short videos) alongside
-- generic file attachments. New columns are nullable / default so
-- the migration is non-destructive on existing rows.

-- CreateEnum
CREATE TYPE "MessageAttachmentKind" AS ENUM ('FILE', 'VIDEO_NOTE', 'AUDIO_NOTE', 'IMAGE');

-- AlterTable
ALTER TABLE "MessageAttachment"
  ADD COLUMN "kind" "MessageAttachmentKind" NOT NULL DEFAULT 'FILE',
  ADD COLUMN "durationSec" INTEGER,
  ADD COLUMN "width" INTEGER,
  ADD COLUMN "height" INTEGER;

-- CreateIndex
CREATE INDEX "MessageAttachment_kind_idx" ON "MessageAttachment"("kind");
