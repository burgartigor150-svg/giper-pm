-- Add external integration ids to User and Project
ALTER TABLE "User" ADD COLUMN "bitrixUserId" TEXT;
CREATE UNIQUE INDEX "User_bitrixUserId_key" ON "User"("bitrixUserId");

ALTER TABLE "Project" ADD COLUMN "externalId" TEXT;
ALTER TABLE "Project" ADD COLUMN "externalSource" TEXT;
CREATE UNIQUE INDEX "Project_externalSource_externalId_key" ON "Project"("externalSource", "externalId");
