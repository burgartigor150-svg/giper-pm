import type { PrismaClient } from '@giper/db';
import { TeamlyClient, type TeamlySpace, type TeamlyTreeItem } from './client';
import { proseMirrorToMarkdown } from './proseMirrorToMarkdown';
import { getTeamlyBotUserId } from './botUser';
import {
  tableColumns,
  teamlyTypeToColumnType,
  teamlyValueToString,
  optionLabels,
  propertyExternalId,
} from './tableMapping';

/**
 * One-way TEAMLY → Knowledge Base mirror. Enumerates spaces, then each space's
 * article tree, fetching article bodies (ProseMirror → Markdown) and upserting
 * by external id so re-runs update in place. Hierarchy is rebuilt from each
 * article's breadcrumbs in a second pass (parents may import after children).
 *
 * Attribution: imported articles are owned by the synthetic TEAMLY bot — the
 * TEAMLY article author exposes no email, so we can't match it to a real user.
 *
 * KNOWN GAPS (handled by later slices):
 *  - Smart tables (`inlineDatabaseArticle`) and nested sub-spaces are skipped.
 *  - Hidden/archived source articles are skipped (not imported).
 *  - Deletions/archival in TEAMLY are NOT propagated: an article/space removed
 *    in the source after first import lingers locally. A guarded "soft-archive
 *    rows whose externalId wasn't seen this run" reconcile is a future addition
 *    (must only run on complete, non-capped syncs to avoid mass-archiving).
 */

const SOURCE = 'teamly';

export type RunTeamlySyncOptions = {
  signal?: AbortSignal;
  /** Only re-fetch articles whose TEAMLY updatedAt is newer than what we stored. */
  incremental?: boolean;
  /**
   * After a CLEAN full run (no errors, not aborted, not capped), soft-archive
   * local teamly-sourced rows whose externalId wasn't seen this run — i.e.
   * propagate deletions/archival from TEAMLY (spaces → archivedAt, articles →
   * status DRAFT, hiding them from search/AI). Guarded so a partial/failed run
   * never mass-archives.
   */
  reconcile?: boolean;
  maxArticlesPerSpace?: number;
};

export type RunTeamlySyncResult = {
  ok: boolean;
  spaces: number;
  articles: number;
  /** Smart tables imported (T3) — each TEAMLY table-space → one KnowledgeTable. */
  tables: number;
  /** Total table rows imported (T3). */
  tableRows: number;
  skipped: number;
  archived: number;
  errors: string[];
  durationMs: number;
};

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function runTeamlySync(
  prisma: PrismaClient,
  client: TeamlyClient,
  opts: RunTeamlySyncOptions = {},
): Promise<RunTeamlySyncResult> {
  const start = Date.now();
  const errors: string[] = [];
  // All imported content is owned by the synthetic TEAMLY bot — the source
  // article author carries no email to match against a real local user.
  const botId = await getTeamlyBotUserId(prisma);

  let spaceCount = 0;
  let articleCount = 0;
  let tableCount = 0;
  let tableRowCount = 0;
  let skipped = 0;
  let archived = 0;
  let capped = false;
  const seenSpaceIds: string[] = [];
  // Per-space sync outcome — drives a SAFE, scoped reconcile (a single space's
  // silent-empty tree can't archive another space's content).
  const synced: { teamlySpaceId: string; localSpaceId: string; seenIds: string[] }[] = [];

  // 1. enumerate spaces (paginated)
  const spaces: TeamlySpace[] = [];
  for (let page = 1; page <= 200; page++) {
    if (opts.signal?.aborted) break;
    const { items, lastPage } = await client.listSpaces(page, 50);
    spaces.push(...items);
    if (page >= lastPage) break;
  }

  for (const sp of spaces) {
    if (opts.signal?.aborted) break;
    try {
      const localSpaceId = await upsertSpace(prisma, sp, botId);
      spaceCount++;
      seenSpaceIds.push(sp.id);
      // Classify by TREE ITEM TYPE — the only reliable signal. A smart table's
      // items are `inlineDatabaseArticle` rows; an ordinary space's are
      // `article`. (schemaProperties can't tell them apart: ordinary spaces also
      // carry user article-properties.) A table is a space whose content is
      // database rows and NOT articles; a stray inline row inside an article
      // space (articleN>0) keeps it an article space.
      const probe = (await client.getSpaceTree(sp.id, 1, 60)).items.filter((i) => !i.isArchived);
      const inlineN = probe.filter((i) => i.type === 'inlineDatabaseArticle').length;
      const articleN = probe.filter((i) => i.type === 'article').length;
      const isTable = inlineN > 0 && articleN === 0;
      if (isTable) {
        // Smart table (T3): columns = schemaProperties, rows = inlineDatabaseArticle.
        const res = await syncSpaceTable(prisma, client, sp, localSpaceId, botId, opts);
        tableCount++;
        tableRowCount += res.rows;
        errors.push(...res.errors);
        // A table-space has no KB articles → empty seenIds so the article
        // reconcile leaves it alone (rows reconcile inside syncSpaceTable).
        synced.push({ teamlySpaceId: sp.id, localSpaceId, seenIds: [] });
      } else {
        // A plain space has no mirrored table; if it used to be a smart table,
        // drop the stale KnowledgeTable (columns/rows cascade) so it doesn't
        // linger orphaned after a table→plain transition.
        await prisma.knowledgeTable.deleteMany({ where: { externalSource: SOURCE, externalId: sp.id } });
        const res = await syncSpaceArticles(prisma, client, sp.id, localSpaceId, botId, opts);
        articleCount += res.imported;
        skipped += res.skipped;
        capped = capped || res.capped;
        synced.push({ teamlySpaceId: sp.id, localSpaceId, seenIds: res.seenIds });
        errors.push(...res.errors);
      }
    } catch (e) {
      errors.push(`space ${sp.id}: ${String(e)}`);
    }
  }

  // 2. reconcile (propagate TEAMLY deletions) — only on a clean, complete,
  // uncapped run, and SCOPED carefully so a silent empty/partial API response
  // can never mass-archive real content.
  const cleanFull = errors.length === 0 && !opts.signal?.aborted && !capped && seenSpaceIds.length > 0;
  if (opts.reconcile && cleanFull) {
    archived = await reconcile(prisma, seenSpaceIds, synced, errors);
  }

  return {
    ok: errors.length === 0,
    spaces: spaceCount,
    articles: articleCount,
    tables: tableCount,
    tableRows: tableRowCount,
    skipped,
    archived,
    errors: errors.slice(0, 50),
    durationMs: Date.now() - start,
  };
}

/** Circuit breaker: refuse to archive an implausibly large fraction of spaces
 * in one run — guards a silently-truncated listSpaces. */
const MAX_SPACE_ARCHIVE_FRACTION = 0.3;

/**
 * Safe reconcile. Space-archival is gated by a fraction circuit-breaker; article
 * archival is PER-SPACE and only for spaces whose tree was NON-EMPTY this run
 * (so one space's silent-empty 200 can't DRAFT its whole content, nor anyone
 * else's). Also self-heals: a seen article a prior false-positive left DRAFT is
 * restored to PUBLISHED.
 */
async function reconcile(
  prisma: PrismaClient,
  seenSpaceIds: string[],
  synced: { teamlySpaceId: string; localSpaceId: string; seenIds: string[] }[],
  errors: string[],
): Promise<number> {
  let archived = 0;

  // Spaces removed from TEAMLY → archivedAt, with a circuit breaker.
  const liveSpaces = await prisma.knowledgeSpace.count({ where: { externalSource: SOURCE, archivedAt: null } });
  const toArchive = await prisma.knowledgeSpace.findMany({
    where: { externalSource: SOURCE, archivedAt: null, externalId: { notIn: seenSpaceIds } },
    select: { id: true },
  });
  if (toArchive.length > 0) {
    if (liveSpaces > 0 && toArchive.length / liveSpaces > MAX_SPACE_ARCHIVE_FRACTION) {
      errors.push(
        `reconcile: refused to archive ${toArchive.length}/${liveSpaces} spaces ` +
          `(> ${Math.round(MAX_SPACE_ARCHIVE_FRACTION * 100)}% — likely a partial sync)`,
      );
    } else {
      await prisma.knowledgeSpace.updateMany({ where: { id: { in: toArchive.map((s) => s.id) } }, data: { archivedAt: new Date() } });
      archived += toArchive.length;
    }
  }

  // Articles — per space, non-empty trees only; restore-then-archive.
  for (const s of synced) {
    if (s.seenIds.length === 0) continue; // empty tree → ambiguous, skip
    await prisma.knowledgeArticle.updateMany({
      where: { externalSource: SOURCE, spaceId: s.localSpaceId, status: 'DRAFT', externalId: { in: s.seenIds } },
      data: { status: 'PUBLISHED' },
    });
    const drafted = await prisma.knowledgeArticle.updateMany({
      where: { externalSource: SOURCE, spaceId: s.localSpaceId, status: 'PUBLISHED', externalId: { notIn: s.seenIds } },
      data: { status: 'DRAFT' },
    });
    archived += drafted.count;
  }

  return archived;
}

async function upsertSpace(prisma: PrismaClient, sp: TeamlySpace, botId: string): Promise<string> {
  const existing = await prisma.knowledgeSpace.findUnique({
    where: { externalSource_externalId: { externalSource: SOURCE, externalId: sp.id } },
    select: { id: true },
  });
  if (existing) {
    await prisma.knowledgeSpace.update({
      where: { id: existing.id },
      data: { name: sp.title || 'TEAMLY', description: sp.description ?? null },
    });
    return existing.id;
  }
  const max = await prisma.knowledgeSpace.aggregate({ _max: { order: true } });
  const created = await prisma.knowledgeSpace.create({
    data: {
      name: sp.title || 'TEAMLY',
      description: sp.description ?? null,
      externalSource: SOURCE,
      externalId: sp.id,
      visibility: 'PUBLIC',
      order: (max._max.order ?? -1) + 1,
      createdById: botId,
    },
    select: { id: true },
  });
  return created.id;
}

type ArticleResult = { imported: number; skipped: number; errors: string[]; seenIds: string[]; capped: boolean };

async function syncSpaceArticles(
  prisma: PrismaClient,
  client: TeamlyClient,
  teamlySpaceId: string,
  localSpaceId: string,
  authorId: string,
  opts: RunTeamlySyncOptions,
): Promise<ArticleResult> {
  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;
  let capped = false;

  // collect tree items (articles only)
  const items: TeamlyTreeItem[] = [];
  for (let page = 1; page <= 1000; page++) {
    if (opts.signal?.aborted) break;
    const { items: pageItems, lastPage } = await client.getSpaceTree(teamlySpaceId, page, 60);
    items.push(...pageItems.filter((i) => i.type === 'article' && !i.isArchived));
    if (page >= lastPage) break;
    if (opts.maxArticlesPerSpace && items.length >= opts.maxArticlesPerSpace) {
      capped = true;
      break;
    }
  }

  // existing externalUpdatedAt for incremental skip
  const existing = await prisma.knowledgeArticle.findMany({
    where: { externalSource: SOURCE, externalId: { in: items.map((i) => i.id) } },
    select: { id: true, externalId: true, externalUpdatedAt: true },
  });
  const byExt = new Map(existing.map((e) => [e.externalId!, e]));

  // parent external id per article (from breadcrumbs) for the second pass
  const parentExt = new Map<string, string | null>();

  for (const item of items) {
    if (opts.signal?.aborted) break;
    try {
      const treeUpdated = parseDate(item.updatedAt);
      const prior = byExt.get(item.id);
      if (opts.incremental && prior?.externalUpdatedAt && treeUpdated && treeUpdated <= prior.externalUpdatedAt) {
        skipped++;
        continue;
      }
      const article = await client.getArticle(item.id);
      if (!article) {
        errors.push(`article ${item.id}: not found`);
        continue;
      }
      // Don't mirror source-hidden/archived articles into a PUBLIC space (they'd
      // become org-wide searchable + surface in KB AI answers).
      if (article.is_hidden || article.archived) {
        skipped++;
        continue;
      }
      const md = proseMirrorToMarkdown(article.editorContentObject?.content ?? null);
      const title = article.title || item.title || 'Без названия';
      const externalUpdatedAt = parseDate(item.updatedAt) ?? (article.updated_at ? new Date(article.updated_at * 1000) : null);

      // parent = the breadcrumb just before this article, if it's an article
      const crumbs = article.breadcrumbs ?? [];
      const parentCrumb = crumbs.length >= 2 ? crumbs[crumbs.length - 2] : null;
      parentExt.set(item.id, parentCrumb && parentCrumb.sourceType === 'article' ? parentCrumb.sourceId : null);

      if (prior) {
        await prisma.knowledgeArticle.update({
          where: { id: prior.id },
          data: { title, content: md, status: 'PUBLISHED', externalUpdatedAt, updatedById: authorId },
        });
      } else {
        const max = await prisma.knowledgeArticle.aggregate({ where: { spaceId: localSpaceId, parentId: null }, _max: { order: true } });
        const created = await prisma.knowledgeArticle.create({
          data: {
            spaceId: localSpaceId,
            title,
            content: md,
            status: 'PUBLISHED',
            order: (max._max.order ?? -1) + 1,
            externalSource: SOURCE,
            externalId: item.id,
            externalUpdatedAt,
            createdById: authorId,
            updatedById: authorId,
          },
          select: { id: true },
        });
        byExt.set(item.id, { id: created.id, externalId: item.id, externalUpdatedAt });
      }
      imported++;
    } catch (e) {
      errors.push(`article ${item.id}: ${String(e)}`);
    }
  }

  // second pass: resolve parents + normalise sibling order per parent. Walking
  // `items` (tree order) keeps order contiguous from 0 within each parent group
  // and deterministic across runs — fixing the root-counter collision that an
  // incrementally-added child would otherwise get.
  const localByExt = new Map<string, string>();
  const fresh = await prisma.knowledgeArticle.findMany({
    where: { externalSource: SOURCE, spaceId: localSpaceId, externalId: { in: items.map((i) => i.id) } },
    select: { id: true, externalId: true },
  });
  for (const a of fresh) if (a.externalId) localByExt.set(a.externalId, a.id);

  const orderByParent = new Map<string, number>();
  for (const item of items) {
    const localId = localByExt.get(item.id);
    if (!localId) continue; // hidden/archived/skipped — not imported
    const parentExtId = parentExt.get(item.id) ?? null;
    const localParent = parentExtId ? localByExt.get(parentExtId) ?? null : null;
    const key = localParent ?? '__root__';
    const order = orderByParent.get(key) ?? 0;
    orderByParent.set(key, order + 1);
    await prisma.knowledgeArticle
      .update({ where: { id: localId }, data: { parentId: localParent, order } })
      .catch(() => {});
  }

  return { imported, skipped, errors, seenIds: items.map((i) => i.id), capped };
}

type TableResult = { rows: number; errors: string[] };

/**
 * Sync a TEAMLY smart table (a space with schemaProperties) → one
 * KnowledgeTable in `localSpaceId`: columns from schemaProperties, rows from the
 * space's articles (each article's `properties.properties` = cell values keyed
 * by property code). Upserts table/columns/rows by externalId so re-runs update
 * in place; prunes columns/rows that vanished (row prune is guarded so a
 * silent-empty tree can't wipe the table).
 */
async function syncSpaceTable(
  prisma: PrismaClient,
  client: TeamlyClient,
  sp: TeamlySpace,
  localSpaceId: string,
  botId: string,
  opts: RunTeamlySyncOptions,
): Promise<TableResult> {
  const errors: string[] = [];
  const cols = tableColumns(sp);
  // Namespace column/row externalIds by the space so a property `code` (or id)
  // that recurs across two table-spaces can never steal another table's column.
  const ns = (id: string) => `${sp.id}::${id}`;

  // 1. upsert the table (externalId = the TEAMLY space id).
  const existingTable = await prisma.knowledgeTable.findUnique({
    where: { externalSource_externalId: { externalSource: SOURCE, externalId: sp.id } },
    select: { id: true },
  });
  let tableId: string;
  if (existingTable) {
    await prisma.knowledgeTable.update({
      where: { id: existingTable.id },
      data: { name: sp.title || 'Таблица', externalUpdatedAt: new Date() },
    });
    tableId = existingTable.id;
  } else {
    const max = await prisma.knowledgeTable.aggregate({ where: { spaceId: localSpaceId }, _max: { order: true } });
    const created = await prisma.knowledgeTable.create({
      data: {
        spaceId: localSpaceId,
        name: sp.title || 'Таблица',
        order: (max._max.order ?? -1) + 1,
        createdById: botId,
        externalSource: SOURCE,
        externalId: sp.id,
        externalUpdatedAt: new Date(),
      },
      select: { id: true },
    });
    tableId = created.id;
  }

  // 2. upsert columns (externalId = property id) → build code → local column id.
  const colIdByCode = new Map<string, string>();
  const seenColExt: string[] = [];
  let colOrder = 0;
  for (const p of cols) {
    const ext = propertyExternalId(p);
    if (!ext || !p.code) continue;
    const extId = ns(ext);
    const type = teamlyTypeToColumnType(p.type);
    const options = type === 'SELECT' ? optionLabels(p.options) : null;
    const existingCol = await prisma.knowledgeTableColumn.findUnique({
      where: { externalSource_externalId: { externalSource: SOURCE, externalId: extId } },
      select: { id: true },
    });
    let colId: string;
    if (existingCol) {
      await prisma.knowledgeTableColumn.update({
        where: { id: existingCol.id },
        data: { tableId, name: p.name || 'Столбец', type, options: options ?? undefined, order: colOrder },
      });
      colId = existingCol.id;
    } else {
      const c = await prisma.knowledgeTableColumn.create({
        data: { tableId, name: p.name || 'Столбец', type, options: options ?? undefined, order: colOrder, externalSource: SOURCE, externalId: extId },
        select: { id: true },
      });
      colId = c.id;
    }
    colIdByCode.set(p.code, colId);
    seenColExt.push(extId);
    colOrder++;
  }
  // Prune columns that vanished — skip on abort (a truncated schemaProperties
  // response must not wipe columns + orphan row cells).
  if (seenColExt.length > 0 && !opts.signal?.aborted) {
    await prisma.knowledgeTableColumn.deleteMany({
      where: { tableId, externalSource: SOURCE, externalId: { notIn: seenColExt } },
    });
  }

  // 3. rows = the space's articles (each row-article's properties = cell values).
  const rowItems: TeamlyTreeItem[] = [];
  for (let page = 1; page <= 1000; page++) {
    if (opts.signal?.aborted) break;
    const { items, lastPage } = await client.getSpaceTree(sp.id, page, 60);
    rowItems.push(
      ...items.filter((i) => (i.type === 'inlineDatabaseArticle' || i.type === 'article') && !i.isArchived),
    );
    if (page >= lastPage) break;
  }

  let rows = 0;
  let rowOrder = 0;
  let rowErrors = 0;
  const seenRowIds: string[] = [];
  for (const item of rowItems) {
    if (opts.signal?.aborted) break;
    try {
      const article = await client.getArticle(item.id);
      if (!article) {
        errors.push(`row ${item.id}: not found`);
        rowErrors++;
        continue;
      }
      // Don't mirror source-hidden/archived rows into a PUBLIC table (same guard
      // as the article path). Left out of seenRowIds → pruned on a clean run.
      if (article.is_hidden || article.archived) continue;
      const props = article.properties?.properties ?? {};
      const values: Record<string, string> = {};
      for (const p of cols) {
        if (!p.code) continue;
        const colId = colIdByCode.get(p.code);
        if (!colId) continue;
        // The title property's value is the article's own title, not a cell.
        values[colId] =
          p.type === 'title'
            ? article.title || item.title || ''
            : teamlyValueToString(props[p.code], p.type, p.options);
      }
      const rowExtId = ns(item.id);
      const existingRow = await prisma.knowledgeTableRow.findUnique({
        where: { externalSource_externalId: { externalSource: SOURCE, externalId: rowExtId } },
        select: { id: true },
      });
      if (existingRow) {
        await prisma.knowledgeTableRow.update({ where: { id: existingRow.id }, data: { tableId, values, order: rowOrder } });
      } else {
        await prisma.knowledgeTableRow.create({ data: { tableId, values, order: rowOrder, externalSource: SOURCE, externalId: rowExtId } });
      }
      seenRowIds.push(rowExtId);
      rows++;
      rowOrder++;
    } catch (e) {
      errors.push(`row ${item.id}: ${String(e)}`);
      rowErrors++;
    }
  }
  // Prune vanished rows ONLY on a clean, complete pass (no abort, no per-row
  // errors) — a transient blip must never hard-delete still-live rows.
  if (seenRowIds.length > 0 && !opts.signal?.aborted && rowErrors === 0) {
    await prisma.knowledgeTableRow.deleteMany({
      where: { tableId, externalSource: SOURCE, externalId: { notIn: seenRowIds } },
    });
  }

  // A table-space has no standalone KB articles (its items are rows). If this
  // space used to be a plain space, drop the stale mirrored articles so content
  // isn't duplicated (article + row) after a plain→table transition. Gated like
  // the prunes: never clean up on an aborted or columnless (partial/degenerate)
  // sync, so a transient blip can't delete the old representation prematurely.
  if (!opts.signal?.aborted && seenColExt.length > 0) {
    await prisma.knowledgeArticle.deleteMany({ where: { externalSource: SOURCE, spaceId: localSpaceId } });
  }

  return { rows, errors };
}
