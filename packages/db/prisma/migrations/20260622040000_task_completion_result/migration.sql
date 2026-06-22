-- Mandatory close result (итог). Additive + idempotent so it's safe under both
-- `prisma migrate deploy` and `prisma db push`.
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "completionResult" TEXT;
