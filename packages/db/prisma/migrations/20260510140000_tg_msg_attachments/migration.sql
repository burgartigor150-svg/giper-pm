-- Telegram messages may carry files (documents, photos, voice). We store
-- only the file_id descriptor at ingest; actual download happens when a
-- PM accepts an AI-proposed task that references the message.

ALTER TABLE "TelegramProjectMessage" ADD COLUMN "attachments" JSONB;
