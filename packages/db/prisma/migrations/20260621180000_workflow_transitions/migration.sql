-- Configurable workflow — phase 1: a per-project transition allowlist. Additive +
-- inert: a project with zero rows has NO restriction (every status move allowed),
-- so behavior is byte-identical until a project opts in. fromStatus/toStatus reuse
-- the existing TaskStatus enum (the enum stays the engine). (Prisma's
-- searchVector/Meeting/Webhook drift stripped per the giper-pm migration recipe.)

-- CreateTable
CREATE TABLE "WorkflowTransition" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fromStatus" "TaskStatus" NOT NULL,
    "toStatus" "TaskStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowTransition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkflowTransition_projectId_idx" ON "WorkflowTransition"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowTransition_projectId_fromStatus_toStatus_key" ON "WorkflowTransition"("projectId", "fromStatus", "toStatus");

-- AddForeignKey
ALTER TABLE "WorkflowTransition" ADD CONSTRAINT "WorkflowTransition_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
