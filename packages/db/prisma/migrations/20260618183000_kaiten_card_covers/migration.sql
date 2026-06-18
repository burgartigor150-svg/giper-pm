-- Kaiten card covers: additive nullable Task.coverImageKey / Task.coverColor.
-- An image cover stores an S3 object key (served via /api/covers/[taskId]);
-- a colour cover stores a hex string. At most one is set; both null = no cover.
-- (Hand-written additive migration — no Prisma drift drops.)

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "coverImageKey" TEXT,
ADD COLUMN     "coverColor" TEXT;
