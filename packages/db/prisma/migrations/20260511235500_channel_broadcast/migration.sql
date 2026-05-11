-- Add BROADCAST to ChannelKind enum (org-wide read, admin-only post).
ALTER TYPE "ChannelKind" ADD VALUE 'BROADCAST';
