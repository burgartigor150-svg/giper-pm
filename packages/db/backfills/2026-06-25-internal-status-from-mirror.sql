-- One-time backfill (run on prod via psql) — align EXISTING imported tasks whose
-- internal (board) status was hardcoded to BACKLOG on import. New imports now
-- seed internalStatus from the mapped Bitrix/Kaiten status; this fixes the rows
-- created before that change. Idempotent: the WHERE skips already-aligned rows.
--
-- Heuristic for "never moved on the board": internalStatus is still the import
-- default (BACKLOG) while the mirror status differs. A task the user really put
-- in Бэклог (mirror=BACKLOG) is left untouched.

-- 1) internalStatus enum + its FK ← the mirror status.
-- The EXISTS guard skips any project missing its seed Status row for that
-- category (some Bitrix projects predate the status backfill) — without it a
-- dangling internalStatusId FK would abort the whole UPDATE. Such rows simply
-- aren't realigned here; the next sync (which seeds statuses) handles them.
UPDATE "Task" t
SET "internalStatus" = t."status",
    "internalStatusId" = 'st_' || t."projectId" || '_' || t."status"::text
WHERE t."externalSource" IN ('bitrix24', 'kaiten')
  AND t."internalStatus" = 'BACKLOG'
  AND t."status" <> 'BACKLOG'
  AND EXISTS (
    SELECT 1 FROM "Status" s
    WHERE s."id" = 'st_' || t."projectId" || '_' || t."status"::text
  );

-- 2) Re-point columnId for the just-realigned rows that are still parked in a
-- BACKLOG-category column → the matching column (lowest order per status). Tasks
-- manually moved to a real column, or with a null columnId (board fallback
-- already places them), are left alone.
UPDATE "Task" t
SET "columnId" = sub.cid
FROM (
  SELECT DISTINCT ON (c."projectId", c."status") c."projectId", c."status", c."id" AS cid
  FROM "BoardColumn" c
  ORDER BY c."projectId", c."status", c."order"
) sub
WHERE t."externalSource" IN ('bitrix24', 'kaiten')
  AND t."internalStatus" <> 'BACKLOG'
  AND sub."projectId" = t."projectId"
  AND sub."status" = t."internalStatus"
  AND t."columnId" IN (SELECT bc."id" FROM "BoardColumn" bc WHERE bc."status" = 'BACKLOG');
