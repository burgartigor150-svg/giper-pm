-- Cumulative-flow snapshots: daily per-status card counts per project.
-- Additive only — the Prisma-emitted drift (Message.searchVector drop, the
-- deferred Status FKs, Status/Webhook default churn) is intentionally stripped.

-- CreateTable
CREATE TABLE "StatusSnapshot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "TaskStatus" NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatusSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StatusSnapshot_projectId_date_idx" ON "StatusSnapshot"("projectId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "StatusSnapshot_projectId_date_status_key" ON "StatusSnapshot"("projectId", "date", "status");

-- AddForeignKey
ALTER TABLE "StatusSnapshot" ADD CONSTRAINT "StatusSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
