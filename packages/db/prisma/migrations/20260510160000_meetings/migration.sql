-- Video meetings (LiveKit + transcription).

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('PLANNED', 'ACTIVE', 'ENDED', 'PROCESSING', 'READY', 'FAILED');
CREATE TYPE "MeetingKind" AS ENUM ('VIDEO_LIVEKIT', 'TG_VOICE_BATCH');

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'PLANNED',
    "kind" "MeetingKind" NOT NULL DEFAULT 'VIDEO_LIVEKIT',
    "livekitRoomName" TEXT,
    "livekitEgressId" TEXT,
    "recordingKey" TEXT,
    "recordingDurationSec" INTEGER,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "processingError" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Meeting_livekitRoomName_key" ON "Meeting"("livekitRoomName");
CREATE INDEX "Meeting_projectId_status_createdAt_idx" ON "Meeting"("projectId", "status", "createdAt");
CREATE INDEX "Meeting_createdById_createdAt_idx" ON "Meeting"("createdById", "createdAt");

ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "MeetingParticipant" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "userId" TEXT,
    "livekitIdentity" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "MeetingParticipant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MeetingParticipant_meetingId_livekitIdentity_key" ON "MeetingParticipant"("meetingId", "livekitIdentity");
CREATE INDEX "MeetingParticipant_userId_joinedAt_idx" ON "MeetingParticipant"("userId", "joinedAt");

ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "MeetingTranscript" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "fullText" TEXT NOT NULL,
    "segments" JSONB NOT NULL,
    "summary" TEXT,
    "model" TEXT,
    "language" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingTranscript_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MeetingTranscript_meetingId_key" ON "MeetingTranscript"("meetingId");

ALTER TABLE "MeetingTranscript" ADD CONSTRAINT "MeetingTranscript_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
