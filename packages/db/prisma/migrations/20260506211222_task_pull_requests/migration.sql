CREATE TYPE "PullRequestState" AS ENUM ('OPEN', 'CLOSED', 'MERGED', 'DRAFT');

CREATE TABLE "TaskPullRequest" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "repo" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "state" "PullRequestState" NOT NULL DEFAULT 'OPEN',
  "url" TEXT NOT NULL,
  "headRef" TEXT,
  "baseRef" TEXT,
  "authorLogin" TEXT,
  "mergedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TaskPullRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TaskPullRequest_repo_number_taskId_key" ON "TaskPullRequest"("repo", "number", "taskId");
CREATE INDEX "TaskPullRequest_taskId_idx" ON "TaskPullRequest"("taskId");
CREATE INDEX "TaskPullRequest_repo_number_idx" ON "TaskPullRequest"("repo", "number");

ALTER TABLE "TaskPullRequest" ADD CONSTRAINT "TaskPullRequest_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
