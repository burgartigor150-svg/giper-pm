-- Bitrix24 moved task discussions from the legacy forum API
-- (task.commentitem.*) into the IM messenger. Store the upstream
-- CHAT_ID locally so webhook/backfill comment sync can route to
-- im.dialog.messages.get instead of returning empty getlist results.
ALTER TABLE "Task" ADD COLUMN "bitrixChatId" TEXT;
