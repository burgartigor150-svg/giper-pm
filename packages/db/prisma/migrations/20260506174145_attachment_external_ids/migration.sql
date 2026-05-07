-- Make uploadedById nullable (mirrored files have no local uploader)
ALTER TABLE "Attachment" ALTER COLUMN "uploadedById" DROP NOT NULL;

-- Add external linkage so we can dedupe attachment rows across syncs
ALTER TABLE "Attachment" ADD COLUMN "externalSource" TEXT;
ALTER TABLE "Attachment" ADD COLUMN "externalId" TEXT;
CREATE UNIQUE INDEX "Attachment_externalSource_externalId_key" ON "Attachment"("externalSource", "externalId");
