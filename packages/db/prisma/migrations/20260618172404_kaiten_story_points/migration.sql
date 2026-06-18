-- Kaiten story points: additive nullable Task.storyPoints (metadata-only).
-- (Stripped Prisma's spurious Message.searchVector / raw-index drops.)

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "storyPoints" INTEGER;
