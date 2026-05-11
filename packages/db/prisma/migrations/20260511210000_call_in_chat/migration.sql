-- Phase A of "call from chat": link Meeting to a Channel and let
-- Messages carry typed system events (call started / ended etc.).
-- Both columns are nullable so the migration is non-destructive on
-- existing meetings/messages.

-- CreateEnum
CREATE TYPE "MessageEventKind" AS ENUM (
  'CALL_STARTED',
  'CALL_ENDED',
  'MEMBER_CHANGED',
  'CHANNEL_RENAMED'
);

-- AlterTable: Meeting.channelId
ALTER TABLE "Meeting"
  ADD COLUMN "channelId" TEXT;

ALTER TABLE "Meeting"
  ADD CONSTRAINT "Meeting_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex: lookup "current call for this channel".
CREATE INDEX "Meeting_channelId_status_idx" ON "Meeting"("channelId", "status");

-- AlterTable: Message system-event payload
ALTER TABLE "Message"
  ADD COLUMN "eventKind" "MessageEventKind",
  ADD COLUMN "eventPayload" JSONB;
