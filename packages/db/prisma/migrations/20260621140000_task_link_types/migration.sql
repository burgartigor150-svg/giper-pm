-- Task link types: a `linkType` on TaskDependency so a task↔task edge can be
-- BLOCKS (default — existing rows stay blockers), RELATES_TO, or DUPLICATES.
-- Additive: the column defaults to BLOCKS so every pre-existing edge is
-- unchanged; the unique key is widened to include linkType so a pair can carry
-- more than one relation. (Prisma's searchVector/Meeting/Webhook drift stripped
-- per the giper-pm migration recipe — those objects are managed outside Prisma.)

-- CreateEnum
CREATE TYPE "TaskLinkType" AS ENUM ('BLOCKS', 'RELATES_TO', 'DUPLICATES');

-- DropIndex (old 2-col unique)
DROP INDEX "TaskDependency_fromTaskId_toTaskId_key";

-- AlterTable (existing rows default to BLOCKS)
ALTER TABLE "TaskDependency" ADD COLUMN     "linkType" "TaskLinkType" NOT NULL DEFAULT 'BLOCKS';

-- CreateIndex (widened 3-col unique)
CREATE UNIQUE INDEX "TaskDependency_fromTaskId_toTaskId_linkType_key" ON "TaskDependency"("fromTaskId", "toTaskId", "linkType");
