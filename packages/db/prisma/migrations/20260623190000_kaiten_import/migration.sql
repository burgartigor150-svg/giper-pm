-- Kaiten card import: per-project integration kind. Config (domain, encrypted
-- token, board id, last-sync summary) lives in ProjectIntegration.config JSON,
-- so no new tables/columns are needed. Additive + idempotent.
ALTER TYPE "IntegrationKind" ADD VALUE IF NOT EXISTS 'KAITEN';

-- Hot-path index for mirror upserts: find a task by external id within a project.
-- Non-unique because prod already holds duplicate (projectId, source, externalId)
-- tuples among legacy Bitrix tasks. Name matches Prisma's @@index so `db push`
-- (CI) and `migrate deploy` (prod) agree.
CREATE INDEX IF NOT EXISTS "Task_projectId_externalSource_externalId_idx"
  ON "Task" ("projectId", "externalSource", "externalId");

-- Hard idempotency guard for Kaiten imports only (zero kaiten rows exist yet, so
-- this creates cleanly): one task per (project, Kaiten card id). A concurrent
-- re-sync that races the find→create check hits this and resolves to an update.
-- Partial predicate is not expressible in the Prisma schema, so this index lives
-- only in migrations/prod (CI db-push omits it; treated as benign drift).
CREATE UNIQUE INDEX IF NOT EXISTS "Task_kaiten_card_key"
  ON "Task" ("projectId", "externalId")
  WHERE "externalSource" = 'kaiten';
