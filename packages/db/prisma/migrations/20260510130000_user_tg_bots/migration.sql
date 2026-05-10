-- Personal Telegram bots: each PM connects their own BotFather bot.
-- Replaces the previous single-org-bot model (TG_BOT_TOKEN env + /pair flow).

-- 1) Drop legacy single-bot pairing on User.
DROP INDEX IF EXISTS "User_tgChatId_key";
ALTER TABLE "User" DROP COLUMN IF EXISTS "tgChatId";
ALTER TABLE "User" DROP COLUMN IF EXISTS "tgUsername";

-- 2) Wipe any existing project↔chat links — old rows have no owning bot
--    and the old single-bot worker is going away. Empty buffer too.
TRUNCATE TABLE "TelegramProjectMessage" CASCADE;
TRUNCATE TABLE "ProjectTelegramChat" CASCADE;

-- 3) New table: per-user Telegram bot with encrypted token.
CREATE TABLE "UserTelegramBot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "botTgId" TEXT NOT NULL,
    "botUsername" TEXT NOT NULL,
    "botName" TEXT,
    "encryptedToken" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastPolledAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTelegramBot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserTelegramBot_botTgId_key" ON "UserTelegramBot"("botTgId");
CREATE INDEX "UserTelegramBot_userId_idx" ON "UserTelegramBot"("userId");
CREATE INDEX "UserTelegramBot_isActive_idx" ON "UserTelegramBot"("isActive");

ALTER TABLE "UserTelegramBot"
    ADD CONSTRAINT "UserTelegramBot_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4) Re-shape ProjectTelegramChat: it now belongs to a specific bot.
DROP INDEX IF EXISTS "ProjectTelegramChat_telegramChatId_key";
ALTER TABLE "ProjectTelegramChat" ADD COLUMN "botId" TEXT NOT NULL;

CREATE UNIQUE INDEX "ProjectTelegramChat_botId_telegramChatId_key"
    ON "ProjectTelegramChat"("botId", "telegramChatId");
CREATE INDEX "ProjectTelegramChat_botId_idx" ON "ProjectTelegramChat"("botId");

ALTER TABLE "ProjectTelegramChat"
    ADD CONSTRAINT "ProjectTelegramChat_botId_fkey"
    FOREIGN KEY ("botId") REFERENCES "UserTelegramBot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
