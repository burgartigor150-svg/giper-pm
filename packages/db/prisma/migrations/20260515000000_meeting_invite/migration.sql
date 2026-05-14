-- Guest invite links for meetings: shareable URL that lets an external
-- (no giper-pm account) person join a LiveKit room with a guest JWT.
CREATE TABLE "MeetingInvite" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MeetingInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MeetingInvite_token_key" ON "MeetingInvite"("token");
CREATE INDEX "MeetingInvite_meetingId_revokedAt_idx" ON "MeetingInvite"("meetingId", "revokedAt");

ALTER TABLE "MeetingInvite"
  ADD CONSTRAINT "MeetingInvite_meetingId_fkey"
  FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MeetingInvite"
  ADD CONSTRAINT "MeetingInvite_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
