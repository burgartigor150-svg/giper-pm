-- ProjectBitrixMember: mirror of Bitrix sonet_group membership.
-- See packages/db/prisma/schema.prisma for the design rationale.
--
-- NOTE: prisma migrate dev wanted to also DROP Message.searchVector
-- as part of this diff (the column exists in the DB but not in the
-- schema). That's a separate, unrelated drift — removed from this
-- migration so this one stays focused. Address searchVector in its
-- own dedicated migration if/when we decide to clean it up.

-- CreateTable
CREATE TABLE "ProjectBitrixMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "bitrixUserId" TEXT NOT NULL,
    "userId" TEXT,
    "role" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectBitrixMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectBitrixMember_userId_idx" ON "ProjectBitrixMember"("userId");

-- CreateIndex
CREATE INDEX "ProjectBitrixMember_projectId_idx" ON "ProjectBitrixMember"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectBitrixMember_projectId_bitrixUserId_key" ON "ProjectBitrixMember"("projectId", "bitrixUserId");

-- AddForeignKey
ALTER TABLE "ProjectBitrixMember" ADD CONSTRAINT "ProjectBitrixMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBitrixMember" ADD CONSTRAINT "ProjectBitrixMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
