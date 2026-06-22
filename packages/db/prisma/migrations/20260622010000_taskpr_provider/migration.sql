-- GitLab support: tag each linked PR/MR with its source forge so the task
-- page can label it (PR vs MR) and pick the right icon. Additive; existing
-- rows default to github.
ALTER TABLE "TaskPullRequest" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'github';
