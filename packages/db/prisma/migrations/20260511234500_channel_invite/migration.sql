-- ChannelInvite: Telegram-style invite links for PRIVATE channels.
CREATE TABLE "ChannelInvite" (
  "id" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "maxUses" INTEGER,
  "useCount" INTEGER NOT NULL DEFAULT 0,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChannelInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChannelInvite_token_key" ON "ChannelInvite"("token");
CREATE INDEX "ChannelInvite_channelId_revokedAt_idx" ON "ChannelInvite"("channelId", "revokedAt");

ALTER TABLE "ChannelInvite"
  ADD CONSTRAINT "ChannelInvite_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChannelInvite"
  ADD CONSTRAINT "ChannelInvite_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
