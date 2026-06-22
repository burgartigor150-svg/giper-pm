-- GitLab commit comments need their own CommentSource. Separate migration so
-- the enum value add isn't bundled with other DDL (ALTER TYPE ADD VALUE).
ALTER TYPE "CommentSource" ADD VALUE IF NOT EXISTS 'GITLAB';
