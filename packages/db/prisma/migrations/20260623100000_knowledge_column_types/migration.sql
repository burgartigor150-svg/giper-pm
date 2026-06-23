-- Smart-table relation + formula column types. Additive + idempotent.
ALTER TYPE "KnowledgeColumnType" ADD VALUE IF NOT EXISTS 'RELATION';
ALTER TYPE "KnowledgeColumnType" ADD VALUE IF NOT EXISTS 'FORMULA';
