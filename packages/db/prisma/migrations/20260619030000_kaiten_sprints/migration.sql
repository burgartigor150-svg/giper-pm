-- Kaiten Scrum sprints: project-scoped time-boxed iterations + nullable
-- Task.sprintId. Additive: new enum + table + one nullable Task column + one
-- new index. ON DELETE SET NULL → deleting a sprint returns cards to backlog.
-- One-ACTIVE-per-project is enforced in the app layer (db push can't do partial unique).

-- CreateEnum
CREATE TYPE "SprintStatus" AS ENUM ('PLANNED', 'ACTIVE', 'CLOSED');

-- CreateTable
CREATE TABLE "Sprint" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "status" "SprintStatus" NOT NULL DEFAULT 'PLANNED',
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sprint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Sprint_projectId_status_idx" ON "Sprint"("projectId", "status");

-- AddForeignKey
ALTER TABLE "Sprint" ADD CONSTRAINT "Sprint_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable (additive nullable column → metadata-only, no Task rewrite)
ALTER TABLE "Task" ADD COLUMN "sprintId" TEXT;

-- CreateIndex (new index on the new column only — touches no existing Task index)
CREATE INDEX "Task_sprintId_internalStatus_idx" ON "Task"("sprintId", "internalStatus");

-- AddForeignKey (SetNull → deleting a sprint returns its cards to the backlog)
ALTER TABLE "Task" ADD CONSTRAINT "Task_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
