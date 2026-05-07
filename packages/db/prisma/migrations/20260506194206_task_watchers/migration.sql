CREATE TABLE "TaskWatcher" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TaskWatcher_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaskWatcher_taskId_userId_key" ON "TaskWatcher"("taskId", "userId");
CREATE INDEX "TaskWatcher_userId_idx" ON "TaskWatcher"("userId");

ALTER TABLE "TaskWatcher" ADD CONSTRAINT "TaskWatcher_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskWatcher" ADD CONSTRAINT "TaskWatcher_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
