-- Materialize the per-project TESTING Status row + board column for the new
-- TESTING stage. Runs AFTER 20260629071000_status_category_testing commits the
-- enum value (the value can't be used in the tx it was added). Mirrors the
-- TS STATUS_SEED / DEFAULT_BOARD_COLUMNS edits so prod (migrate deploy) lands
-- the same state CI derives via `prisma db push` + seed. All steps idempotent.

-- (a) Seed the TESTING Status row for every project. Deterministic id
--     st_<projectId>_TESTING. NOT EXISTS covers BOTH the id AND the
--     @@unique([projectId,name]) constraint, so a project that already has a
--     status named «Тестирование» is skipped instead of aborting the migration.
INSERT INTO "Status" ("id","projectId","name","category","order","isDefault","color","createdAt","updatedAt")
SELECT 'st_'||p."id"||'_TESTING', p."id", 'Тестирование', 'TESTING'::"StatusCategory", 3, true, '#22d3ee', now(), now()
FROM "Project" p
WHERE NOT EXISTS (
  SELECT 1 FROM "Status" s
  WHERE s."projectId" = p."id"
    AND (s."id" = 'st_'||p."id"||'_TESTING' OR s."name" = 'Тестирование')
);

-- (b) Bump the order of the default seed rows that now sit after TESTING so the
--     status list stays contiguous (REVIEW->4, BLOCKED->5, DONE->6, CANCELED->7).
--     The `order <` guard makes re-runs no-ops and leaves user-reordered rows alone.
UPDATE "Status" SET "order" = "order" + 1
WHERE "isDefault" = true
  AND "category" IN ('REVIEW','BLOCKED','DONE','CANCELED')
  AND "order" < (CASE "category"
                   WHEN 'REVIEW'   THEN 4
                   WHEN 'BLOCKED'  THEN 5
                   WHEN 'DONE'     THEN 6
                   WHEN 'CANCELED' THEN 7
                 END);

-- (c1) On boards that already have materialized columns, shift every column
--      AFTER the in-progress stage one slot right so the new TESTING column gets
--      a unique, contiguous order (no tie with REVIEW). Anchor = the LAST
--      in-progress column (MAX order) so TESTING lands just before review/done;
--      works for both default and free-form boards. The NOT EXISTS TESTING guard
--      makes this a no-op on re-runs and on boards that already have the column.
UPDATE "BoardColumn" b SET "order" = b."order" + 1
FROM (
  SELECT "projectId", MAX("order") AS anchor
  FROM "BoardColumn" WHERE "status" = 'IN_PROGRESS'::"TaskStatus"
  GROUP BY "projectId"
) a
WHERE b."projectId" = a."projectId"
  AND b."order" > a.anchor
  AND NOT EXISTS (
    SELECT 1 FROM "BoardColumn" t
    WHERE t."projectId" = b."projectId" AND t."status" = 'TESTING'::"TaskStatus"
  );

-- (c2) Insert exactly ONE TESTING BoardColumn per project (at anchor+1), only
--      for projects that have an in-progress column and no TESTING column yet.
--      The MAX-order subquery guarantees one row per project even on free-form
--      boards with multiple in-progress columns. statusId -> seeded TESTING row.
INSERT INTO "BoardColumn" ("id","projectId","name","status","statusId","order","createdAt","updatedAt")
SELECT gen_random_uuid()::text, a."projectId", 'Тестирование', 'TESTING'::"TaskStatus",
       'st_'||a."projectId"||'_TESTING', a.anchor + 1, now(), now()
FROM (
  SELECT "projectId", MAX("order") AS anchor
  FROM "BoardColumn" WHERE "status" = 'IN_PROGRESS'::"TaskStatus"
  GROUP BY "projectId"
) a
WHERE NOT EXISTS (
  SELECT 1 FROM "BoardColumn" b
  WHERE b."projectId" = a."projectId" AND b."status" = 'TESTING'::"TaskStatus"
);
