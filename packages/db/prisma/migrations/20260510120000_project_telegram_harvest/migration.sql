-- Telegram chat ↔ project linking + message buffer for /harvest → Task creation.

CREATE TABLE "ProjectTelegramChat" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "telegramChatId" TEXT NOT NULL,
    "chatTitle" TEXT,
    "linkedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectTelegramChat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectTelegramChat_telegramChatId_key" ON "ProjectTelegramChat"("telegramChatId");
CREATE INDEX "ProjectTelegramChat_projectId_idx" ON "ProjectTelegramChat"("projectId");

ALTER TABLE "ProjectTelegramChat" ADD CONSTRAINT "ProjectTelegramChat_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectTelegramChat" ADD CONSTRAINT "ProjectTelegramChat_linkedByUserId_fkey" FOREIGN KEY ("linkedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "TelegramProjectMessage" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "telegramChatId" TEXT NOT NULL,
    "messageId" INTEGER NOT NULL,
    "fromTgUserId" TEXT,
    "fromUsername" TEXT,
    "text" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "harvestedAt" TIMESTAMP(3),

    CONSTRAINT "TelegramProjectMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramProjectMessage_telegramChatId_messageId_key" ON "TelegramProjectMessage"("telegramChatId", "messageId");
CREATE INDEX "TelegramProjectMessage_linkId_harvestedAt_capturedAt_idx" ON "TelegramProjectMessage"("linkId", "harvestedAt", "capturedAt");

ALTER TABLE "TelegramProjectMessage" ADD CONSTRAINT "TelegramProjectMessage_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "ProjectTelegramChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
