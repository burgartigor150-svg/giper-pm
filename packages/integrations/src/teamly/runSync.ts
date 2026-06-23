import type { PrismaClient } from '@giper/db';
import { TeamlyClient, type TeamlySpace, type TeamlyTreeItem } from './client';
import { proseMirrorToMarkdown } from './proseMirrorToMarkdown';
import { getTeamlyBotUserId } from './botUser';

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
  let skipped = 0;
  let archived = 0;
  let capped = false;
  const seenSpaceIds: string[] = [];
  const seenArticleIds: string[] = [];

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
      const res = await syncSpaceArticles(prisma, client, sp.id, localSpaceId, botId, opts);
      articleCount += res.imported;
      skipped += res.skipped;
      capped = capped || res.capped;
      seenArticleIds.push(...res.seenIds);
      errors.push(...res.errors);
    } catch (e) {
      errors.push(`space ${sp.id}: ${String(e)}`);
    }
  }

  // 2. reconcile (propagate deletions) — only on a clean, complete, uncapped run
  // with non-empty results, so a partial/auth-failed run can't archive the KB.
  const cleanFull = errors.length === 0 && !opts.signal?.aborted && !capped && seenSpaceIds.length > 0;
  if (opts.reconcile && cleanFull) {
    const sp = await prisma.knowledgeSpace.updateMany({
      where: { externalSource: SOURCE, archivedAt: null, externalId: { notIn: seenSpaceIds } },
      data: { archivedAt: new Date() },
    });
    let art = { count: 0 };
    if (seenArticleIds.length > 0) {
      art = await prisma.knowledgeArticle.updateMany({
        where: { externalSource: SOURCE, status: 'PUBLISHED', externalId: { notIn: seenArticleIds } },
        data: { status: 'DRAFT' },
      });
    }
    archived = sp.count + art.count;
  }

  return {
    ok: errors.length === 0,
    spaces: spaceCount,
    articles: articleCount,
    skipped,
    archived,
    errors: errors.slice(0, 50),
    durationMs: Date.now() - start,
  };
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
