-- Kaiten↔Bitrix medium-confidence match suggestions awaiting human review.
-- Additive + idempotent.
CREATE TABLE IF NOT EXISTS "KaitenMatchSuggestion" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "kaitenTaskId" TEXT NOT NULL,
  "bitrixTaskId" TEXT NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3),
  "decidedById" TEXT,
  CONSTRAINT "KaitenMatchSuggestion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "KaitenMatchSuggestion_kaitenTaskId_bitrixTaskId_key"
  ON "KaitenMatchSuggestion" ("kaitenTaskId", "bitrixTaskId");
CREATE INDEX IF NOT EXISTS "KaitenMatchSuggestion_projectId_status_idx"
  ON "KaitenMatchSuggestion" ("projectId", "status");

DO $$ BEGIN
  ALTER TABLE "KaitenMatchSuggestion" ADD CONSTRAINT "KaitenMatchSuggestion_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "KaitenMatchSuggestion" ADD CONSTRAINT "KaitenMatchSuggestion_kaitenTaskId_fkey"
    FOREIGN KEY ("kaitenTaskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "KaitenMatchSuggestion" ADD CONSTRAINT "KaitenMatchSuggestion_bitrixTaskId_fkey"
    FOREIGN KEY ("bitrixTaskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
