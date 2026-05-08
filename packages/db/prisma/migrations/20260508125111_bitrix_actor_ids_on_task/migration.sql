-- Preserve upstream Bitrix24 actor ids on Task so the read-only mirror
-- panel can render the real upstream creator/assignee independently of
-- whether the matching local User row exists yet.
ALTER TABLE "Task" ADD COLUMN "bitrixCreatedById" TEXT;
ALTER TABLE "Task" ADD COLUMN "bitrixResponsibleId" TEXT;
