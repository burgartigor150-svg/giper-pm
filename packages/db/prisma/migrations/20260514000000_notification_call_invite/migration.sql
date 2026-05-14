-- Add CALL_INVITE so meeting-start notifications have their own kind
-- (used by the inbox bell and any future per-kind preferences). Inserted
-- before SYSTEM so the dropdown order in admin tools stays grouped.
ALTER TYPE "NotificationKind" ADD VALUE 'CALL_INVITE' BEFORE 'SYSTEM';
