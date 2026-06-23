-- Mirror provenance + outbound dedupe for messenger messages (Bitrix24 collab
-- group chat). Additive + idempotent.
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "externalSource" TEXT;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Message_externalSource_externalId_key"
  ON "Message" ("externalSource", "externalId");
