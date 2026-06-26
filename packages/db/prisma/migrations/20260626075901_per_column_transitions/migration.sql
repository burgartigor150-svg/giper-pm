-- Per-column workflow transitions (additive, inert until rows are added).
-- Gates same-category column→column moves on free-form boards. A fresh table
-- with a real composite unique — no existing table is touched, so no DROP
-- CONSTRAINT / DROP INDEX (the recipe's drift, incl. the deferred Status FKs and
-- the Message.searchVector column, is intentionally NOT emitted here).

-- CreateTable
CREATE TABLE "WorkflowColumnTransition" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fromColumnId" TEXT NOT NULL,
    "toColumnId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowColumnTransition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkflowColumnTransition_projectId_idx" ON "WorkflowColumnTransition"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowColumnTransition_projectId_fromColumnId_toColumnId_key" ON "WorkflowColumnTransition"("projectId", "fromColumnId", "toColumnId");

-- AddForeignKey
ALTER TABLE "WorkflowColumnTransition" ADD CONSTRAINT "WorkflowColumnTransition_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowColumnTransition" ADD CONSTRAINT "WorkflowColumnTransition_fromColumnId_fkey" FOREIGN KEY ("fromColumnId") REFERENCES "BoardColumn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowColumnTransition" ADD CONSTRAINT "WorkflowColumnTransition_toColumnId_fkey" FOREIGN KEY ("toColumnId") REFERENCES "BoardColumn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
