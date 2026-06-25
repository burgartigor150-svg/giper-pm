-- Time-tracking: a manual work-phase tag (stage) + a free-form label (name) for
-- no-task entries. Additive + idempotent.
DO $$ BEGIN
  CREATE TYPE "WorkStage" AS ENUM ('DISCOVERY', 'ANALYSIS', 'DEVELOPMENT', 'TESTING', 'MEETING');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "TimeEntry" ADD COLUMN IF NOT EXISTS "stage" "WorkStage";
ALTER TABLE "TimeEntry" ADD COLUMN IF NOT EXISTS "name" TEXT;
