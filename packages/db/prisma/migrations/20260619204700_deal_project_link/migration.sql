-- AlterTable: link a CRM Deal to a delivery Project (additive, nullable).
ALTER TABLE "Deal" ADD COLUMN "projectId" TEXT;

-- CreateIndex
CREATE INDEX "Deal_projectId_idx" ON "Deal"("projectId");

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
