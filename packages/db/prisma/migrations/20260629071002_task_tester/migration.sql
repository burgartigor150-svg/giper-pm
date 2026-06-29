-- Optional TESTING (QA) gate on a task: the assigned tester. Mirrors the
-- reviewer slot (Task.reviewerId) exactly. Nullable + additive + safe.
--
-- The FK is ON DELETE SET NULL so deleting a tester User nulls the slot
-- instead of cascade-deleting their tested tasks. IF NOT EXISTS / DO $$ guards
-- keep the migration idempotent-safe on re-runs (PG12+).

ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "testerId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Task_testerId_fkey'
  ) THEN
    ALTER TABLE "Task"
      ADD CONSTRAINT "Task_testerId_fkey"
      FOREIGN KEY ("testerId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
