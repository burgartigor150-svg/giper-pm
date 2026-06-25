-- Bitrix24 calendar mirror: provenance columns on CalendarEvent so a re-sync
-- dedupes per (source, externalId) instead of re-creating events. Additive +
-- idempotent. The unique pair only constrains non-null rows (Postgres treats
-- NULLs as distinct), so native giper events (both null) are unaffected.
ALTER TABLE "CalendarEvent" ADD COLUMN IF NOT EXISTS "externalSource" TEXT;
ALTER TABLE "CalendarEvent" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "CalendarEvent_externalSource_externalId_key"
  ON "CalendarEvent"("externalSource", "externalId");
