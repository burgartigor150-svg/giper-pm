-- One-time backfill: reattribute Bitrix-mirrored comments/history/chat that the
-- OLD sync fallback wrongly pinned on a real admin to the inert "Bitrix24" bot.
--
-- SAFETY: a Comment with externalSource='bitrix24' whose AUTHOR has NO
-- bitrixUserId can only have come from the pull-sync fallback. A genuinely
-- local comment that was PUSHED to Bitrix (which is what stamps
-- externalSource='bitrix24' on a local row) requires the author to have a
-- bitrixUserId — pushComment throws otherwise. So filtering on
-- author.bitrixUserId IS NULL targets exactly the mis-attributed pulled rows and
-- never touches a real user's own comment. No Bitrix API calls; runs on deploy.
--
-- NOTE: comments wrongly pinned on an admin who IS Bitrix-linked are NOT touched
-- here (can't be distinguished from that admin's genuine comments without
-- re-fetching the upstream author) — those self-heal on a full re-sync.

-- 1. Ensure the bot exists (email is the anchor getBitrixBotUserId() upserts on;
--    if a sync already created it with a cuid id, this is a no-op).
INSERT INTO "User" ("id", "email", "name", "role", "isActive", "createdAt", "updatedAt")
VALUES ('usr_bitrix24_bot', 'bitrix24-bot@giper.local', 'Bitrix24', 'VIEWER'::"UserRole", false, NOW(), NOW())
ON CONFLICT ("email") DO NOTHING;

-- 2. Reattribute the mis-attributed mirrored comments to the bot.
UPDATE "Comment"
SET "authorId" = (SELECT "id" FROM "User" WHERE "email" = 'bitrix24-bot@giper.local')
WHERE "externalSource" = 'bitrix24'
  AND "authorId" IN (
    SELECT "id" FROM "User"
    WHERE "bitrixUserId" IS NULL
      AND "email" <> 'bitrix24-bot@giper.local'
  );
