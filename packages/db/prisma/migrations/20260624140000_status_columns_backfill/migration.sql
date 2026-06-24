-- S2 — materialize default board columns for projects that have none (M4) +
-- backfill card placement onto columnId (M5). Additive + idempotent. The
-- legacy enum tracks remain authoritative; this only fills the shadow FKs the
-- cores now dual-write so S3 can flip the board onto columnId.

-- M4: 6 default columns (mirrors DEFAULT_BOARD_COLUMNS; CANCELED hidden) for any
-- project with ZERO BoardColumn rows. Guarded by NOT EXISTS → re-runnable.
INSERT INTO "BoardColumn" ("id","projectId","name","status","statusId","order","createdAt","updatedAt")
SELECT gen_random_uuid()::text, p."id", v.label, v.cat::"TaskStatus",
       'st_'||p."id"||'_'||v.cat, v.ord, now(), now()
FROM "Project" p CROSS JOIN (VALUES
  ('BACKLOG','Бэклог',0),
  ('TODO','К работе',1),
  ('IN_PROGRESS','В работе',2),
  ('REVIEW','На ревью',3),
  ('BLOCKED','Заблокирована',4),
  ('DONE','Готово',5)
) AS v(cat,label,ord)
WHERE NOT EXISTS (SELECT 1 FROM "BoardColumn" bc WHERE bc."projectId" = p."id");

-- M5: card placement → columnId (lowest-order column matching the INTERNAL
-- status). CANCELED tasks get no column (board hides them) → stay NULL.
UPDATE "Task" t SET "columnId" = sub.cid
FROM (SELECT DISTINCT ON (c."projectId", c."status") c."projectId", c."status", c."id" AS cid
      FROM "BoardColumn" c ORDER BY c."projectId", c."status", c."order") sub
WHERE t."columnId" IS NULL AND sub."projectId" = t."projectId" AND sub."status" = t."internalStatus";
