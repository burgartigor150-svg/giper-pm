-- Opt-in flag (default OFF): auto-move a parent card by its subtasks' status.
-- Additive only — the Prisma-emitted drift (Message.searchVector drop, the
-- deferred Status FKs, Status/Webhook default churn) is intentionally stripped.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "autoMoveParentOnChild" BOOLEAN NOT NULL DEFAULT false;
