-- Releases / versions (Jira fixVersion). Additive + inert until a version is
-- created: new enum + table + a nullable Task.versionId (SetNull). Zero change to
-- existing rows. (Prisma's searchVector/Meeting/Webhook drift stripped per the
-- giper-pm migration recipe — those objects are managed outside Prisma.)

-- CreateEnum
CREATE TYPE "VersionStatus" AS ENUM ('PLANNED', 'RELEASED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "Version" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "VersionStatus" NOT NULL DEFAULT 'PLANNED',
    "releaseDate" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Version_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Version_projectId_status_idx" ON "Version"("projectId", "status");

-- AlterTable (nullable column — additive, existing rows get NULL)
ALTER TABLE "Task" ADD COLUMN "versionId" TEXT;

-- CreateIndex
CREATE INDEX "Task_versionId_idx" ON "Task"("versionId");

-- AddForeignKey
ALTER TABLE "Version" ADD CONSTRAINT "Version_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE SET NULL ON UPDATE CASCADE;
