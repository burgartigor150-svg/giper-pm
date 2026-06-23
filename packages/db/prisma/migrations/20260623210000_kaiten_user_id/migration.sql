-- Map a Kaiten user to a local User (attribution + assignee). Additive + idempotent.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "kaitenUserId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_kaitenUserId_key" ON "User" ("kaitenUserId");
