-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastPasswordChangeAt" TIMESTAMP(3),
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "passwordHash" TEXT;
