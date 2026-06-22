-- In-app GitHub/GitLab repository connections (token + auto-registered webhook).
CREATE TABLE "RepoConnection" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "baseUrl" TEXT,
    "tokenEnc" TEXT NOT NULL,
    "tokenHint" TEXT NOT NULL,
    "webhookId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RepoConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RepoConnection_provider_repo_projectId_key" ON "RepoConnection"("provider", "repo", "projectId");
CREATE INDEX "RepoConnection_projectId_idx" ON "RepoConnection"("projectId");

ALTER TABLE "RepoConnection" ADD CONSTRAINT "RepoConnection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
