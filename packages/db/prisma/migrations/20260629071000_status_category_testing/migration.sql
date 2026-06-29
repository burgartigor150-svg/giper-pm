-- Add a first-class TESTING stage between IN_PROGRESS and REVIEW.
-- Postgres requires ALTER TYPE ... ADD VALUE to run on its own (the new value
-- cannot be USED in the same transaction it is added), so this migration ONLY
-- alters the two enums. All DML that USES 'TESTING' (Status / BoardColumn seed
-- + order bump) lives in the next migration, which runs after this commits.
--
-- `BEFORE 'REVIEW'` fixes only the enum's internal sort order (matters for
-- orderBy:status and the DISTINCT ON (...) ORDER BY status backfill), placing
-- TESTING ahead of REVIEW. IF NOT EXISTS guards re-runs (PG12+).

ALTER TYPE "StatusCategory" ADD VALUE IF NOT EXISTS 'TESTING' BEFORE 'REVIEW';
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'TESTING' BEFORE 'REVIEW';
