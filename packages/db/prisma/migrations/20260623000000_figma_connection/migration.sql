-- Org-level Figma connection (single row). Additive + idempotent.
CREATE TABLE IF NOT EXISTS "FigmaConnection" (
  "id" TEXT NOT NULL,
  "singleton" TEXT NOT NULL DEFAULT 'figma',
  "tokenEnc" TEXT NOT NULL,
  "tokenHint" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "lastError" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FigmaConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "FigmaConnection_singleton_key" ON "FigmaConnection"("singleton");
