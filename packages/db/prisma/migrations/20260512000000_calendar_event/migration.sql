-- CalendarEvent: lightweight personal/team calendar entries.

CREATE TYPE "EventResponse" AS ENUM ('ACCEPTED', 'DECLINED', 'TENTATIVE');

CREATE TABLE "CalendarEvent" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "projectId" TEXT,
  "startAt" TIMESTAMP(3) NOT NULL,
  "endAt" TIMESTAMP(3) NOT NULL,
  "isAllDay" BOOLEAN NOT NULL DEFAULT false,
  "location" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CalendarEvent_startAt_endAt_idx" ON "CalendarEvent"("startAt", "endAt");
CREATE INDEX "CalendarEvent_projectId_startAt_idx" ON "CalendarEvent"("projectId", "startAt");
CREATE INDEX "CalendarEvent_createdById_startAt_idx" ON "CalendarEvent"("createdById", "startAt");

ALTER TABLE "CalendarEvent"
  ADD CONSTRAINT "CalendarEvent_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CalendarEvent"
  ADD CONSTRAINT "CalendarEvent_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CalendarEventAttendee" (
  "eventId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "response" "EventResponse",
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CalendarEventAttendee_pkey" PRIMARY KEY ("eventId", "userId")
);

CREATE INDEX "CalendarEventAttendee_userId_createdAt_idx" ON "CalendarEventAttendee"("userId", "createdAt");

ALTER TABLE "CalendarEventAttendee"
  ADD CONSTRAINT "CalendarEventAttendee_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CalendarEventAttendee"
  ADD CONSTRAINT "CalendarEventAttendee_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
