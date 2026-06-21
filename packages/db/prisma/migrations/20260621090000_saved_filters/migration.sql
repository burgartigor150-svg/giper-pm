-- Saved filters: named, persisted board/list filter presets. Additive + inert
-- until a user creates one — zero change to existing columns/rows. (Prisma's
-- searchVector/Meeting/Webhook drift stripped per the giper-pm migration recipe;
-- those objects are managed outside Prisma.)

-- CreateEnum
CREATE TYPE "SavedFilterScope" AS ENUM ('BOARD', 'LIST');

-- CreateTable
CREATE TABLE "SavedFilter" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scope" "SavedFilterScope" NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedFilter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedFilter_userId_projectId_scope_idx" ON "SavedFilter"("userId", "projectId", "scope");

-- CreateIndex
CREATE INDEX "SavedFilter_projectId_isShared_idx" ON "SavedFilter"("projectId", "isShared");

-- AddForeignKey
ALTER TABLE "SavedFilter" ADD CONSTRAINT "SavedFilter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedFilter" ADD CONSTRAINT "SavedFilter_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
