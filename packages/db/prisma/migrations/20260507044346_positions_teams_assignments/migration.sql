-- Specialty enum + per-user positions list.
CREATE TYPE "Position" AS ENUM (
  'FRONTEND', 'BACKEND', 'FULLSTACK', 'MOBILE',
  'QA', 'QA_AUTO',
  'DESIGNER', 'UX',
  'ANALYST', 'BA',
  'PM', 'LEAD',
  'DEVOPS', 'SRE',
  'CONTENT', 'MARKETING',
  'OTHER'
);

CREATE TABLE "UserPosition" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "position" "Position" NOT NULL,
  "primary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserPosition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserPosition_userId_position_key" ON "UserPosition"("userId", "position");
CREATE INDEX "UserPosition_position_idx" ON "UserPosition"("position");
ALTER TABLE "UserPosition" ADD CONSTRAINT "UserPosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PM team roster.
CREATE TABLE "PmTeamMember" (
  "id" TEXT NOT NULL,
  "pmId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PmTeamMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PmTeamMember_pmId_memberId_key" ON "PmTeamMember"("pmId", "memberId");
CREATE INDEX "PmTeamMember_memberId_idx" ON "PmTeamMember"("memberId");
ALTER TABLE "PmTeamMember" ADD CONSTRAINT "PmTeamMember_pmId_fkey" FOREIGN KEY ("pmId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PmTeamMember" ADD CONSTRAINT "PmTeamMember_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Multi-assignment with role.
CREATE TABLE "TaskAssignment" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "position" "Position" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT NOT NULL,

  CONSTRAINT "TaskAssignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TaskAssignment_taskId_userId_position_key" ON "TaskAssignment"("taskId", "userId", "position");
CREATE INDEX "TaskAssignment_userId_idx" ON "TaskAssignment"("userId");
CREATE INDEX "TaskAssignment_taskId_idx" ON "TaskAssignment"("taskId");
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Internal status track on Task — defaults to BACKLOG so existing rows
-- get a sensible value. Bitrix mirror keeps writing to `status`; the
-- team-internal flow reads/writes `internalStatus`.
ALTER TABLE "Task" ADD COLUMN "internalStatus" "TaskStatus" NOT NULL DEFAULT 'BACKLOG';
CREATE INDEX "Task_projectId_internalStatus_idx" ON "Task"("projectId", "internalStatus");

-- Backfill: for non-mirrored tasks copy status -> internalStatus so the
-- internal track starts in sync with what users already have. Mirrored
-- tasks get the BACKLOG default — it's correct: their internal flow
-- hasn't started yet.
UPDATE "Task" SET "internalStatus" = "status" WHERE "externalSource" IS NULL;
