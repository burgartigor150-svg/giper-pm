-- Pin/unpin support for chat messages. Nullable columns so existing
-- messages stay unaffected.

ALTER TABLE "Message"
  ADD COLUMN "pinnedAt"   TIMESTAMP(3),
  ADD COLUMN "pinnedById" TEXT;

CREATE INDEX "Message_channelId_pinnedAt_idx" ON "Message"("channelId", "pinnedAt");
