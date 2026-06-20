-- Opt-in per-owner CRM access flag. Additive, constant default → instant
-- metadata-only add on Postgres 16 (no table rewrite). Inert until an admin
-- grants it; ADMIN/PM are unaffected (full CRM regardless of the flag).
ALTER TABLE "User" ADD COLUMN "crmAccess" BOOLEAN NOT NULL DEFAULT false;
