-- Kaiten-style Spaces: org-level folders that GROUP existing Projects.
-- Additive only — no existing table/column/index/constraint is modified.
-- ON DELETE SET NULL → deleting a space ungroups its projects, never deletes them.

-- CreateTable
CREATE TABLE "Space" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Space_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Space_archivedAt_order_idx" ON "Space"("archivedAt", "order");

-- AlterTable (additive NULLABLE column → metadata-only, no Project rewrite)
ALTER TABLE "Project" ADD COLUMN "spaceId" TEXT;

-- CreateIndex (new index on the new column only — touches no existing Project index)
CREATE INDEX "Project_spaceId_idx" ON "Project"("spaceId");

-- AddForeignKey (SetNull → deleting a space ungroups its projects)
ALTER TABLE "Project" ADD CONSTRAINT "Project_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE SET NULL ON UPDATE CASCADE;
