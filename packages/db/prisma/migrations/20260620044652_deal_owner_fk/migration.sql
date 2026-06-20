-- Add the long-missing Deal.ownerId foreign key. The schema has always
-- declared `Deal.owner @relation("DealOwner", ... onDelete: SetNull)`, but no
-- prior migration ever created the constraint, so on prod deleting a User left
-- dangling Deal.ownerId values instead of nulling them. Additive + safe
-- (verified 0 orphan Deal.ownerId rows on prod before shipping).
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
