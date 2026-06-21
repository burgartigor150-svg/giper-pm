-- Task hierarchy from Bitrix24: remember the upstream PARENT_ID so the local
-- parentId self-relation can be resolved in a second pass (relinkBitrixParents).
-- Additive only: one nullable column + two supporting indexes.

ALTER TABLE "Task" ADD COLUMN "bitrixParentId" TEXT;

-- Speeds up the relink UPDATE (join parent.externalId = child.bitrixParentId)
-- and parent→subtask lookups / counts.
CREATE INDEX "Task_parentId_idx" ON "Task"("parentId");
CREATE INDEX "Task_externalSource_bitrixParentId_idx" ON "Task"("externalSource", "bitrixParentId");
