import type { PrismaClient } from '@giper/db';
import { TeamlyClient, type TeamlySpace, type TeamlyTreeItem } from './client';
import { proseMirrorToMarkdown } from './proseMirrorToMarkdown';
import { getTeamlyBotUserId } from './botUser';

/**
 * One-way TEAMLY → Knowledge Base mirror. Enumerates spaces, then each space's
 * article tree, fetching article bodies (ProseMirror → Markdown) and upserting
 * by external id so re-runs update in place. Hierarchy is rebuilt from each
 * article's breadcrumbs in a second pass (parents may import after children).
 * Author is matched to a local user by email, else the synthetic TEAMLY bot.
 *
 * Smart tables (`inlineDatabaseArticle`) and nested sub-spaces are skipped in
 * this slice — handled by later TEAMLY slices.
 */

const SOURCE = 'teamly';

export type RunTeamlySyncOptions = {
  signal?: AbortSignal;
  /** Only re-fetch articles whose TEAMLY updatedAt is newer than what we stored. */
  incremental?: boolean;
  maxArticlesPerSpace?: number;
};

export type RunTeamlySyncResult = {
  ok: boolean;
  spaces: number;
  articles: number;
  skipped: number;
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
  const botId = await getTeamlyBotUserId(prisma);

  const userCache = new Map<string, string>();
  async function resolveAuthor(email: string | null | undefined, fullName?: string | null): Promise<string> {
    void fullName;
    if (!email) return botId;
    const key = email.toLowerCase();
    const cached = userCache.get(key);
    if (cached) return cached;
    const u = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } });
    const id = u?.id ?? botId;
    userCache.set(key, id);
    return id;
  }

  let spaceCount = 0;
  let articleCount = 0;
  let skipped = 0;

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
      const res = await syncSpaceArticles(prisma, client, sp.id, localSpaceId, resolveAuthor, opts);
      articleCount += res.imported;
      skipped += res.skipped;
      errors.push(...res.errors);
    } catch (e) {
      errors.push(`space ${sp.id}: ${String(e)}`);
    }
  }

  return {
    ok: errors.length === 0,
    spaces: spaceCount,
    articles: articleCount,
    skipped,
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

type ArticleResult = { imported: number; skipped: number; errors: string[] };

async function syncSpaceArticles(
  prisma: PrismaClient,
  client: TeamlyClient,
  teamlySpaceId: string,
  localSpaceId: string,
  resolveAuthor: (email: string | null | undefined, fullName?: string | null) => Promise<string>,
  opts: RunTeamlySyncOptions,
): Promise<ArticleResult> {
  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;

  // collect tree items (articles only)
  const items: TeamlyTreeItem[] = [];
  for (let page = 1; page <= 1000; page++) {
    if (opts.signal?.aborted) break;
    const { items: pageItems, lastPage } = await client.getSpaceTree(teamlySpaceId, page, 60);
    items.push(...pageItems.filter((i) => i.type === 'article' && !i.isArchived));
    if (page >= lastPage) break;
    if (opts.maxArticlesPerSpace && items.length >= opts.maxArticlesPerSpace) break;
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
      const md = proseMirrorToMarkdown(article.editorContentObject?.content ?? null);
      const title = article.title || item.title || 'Без названия';
      const authorId = await resolveAuthor(null, article.author?.full_name);
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

  // second pass: resolve parents (all articles now exist locally)
  const localByExt = new Map<string, string>();
  const fresh = await prisma.knowledgeArticle.findMany({
    where: { externalSource: SOURCE, spaceId: localSpaceId, externalId: { in: items.map((i) => i.id) } },
    select: { id: true, externalId: true },
  });
  for (const a of fresh) if (a.externalId) localByExt.set(a.externalId, a.id);
  for (const [extId, parent] of parentExt.entries()) {
    const localId = localByExt.get(extId);
    const localParent = parent ? localByExt.get(parent) ?? null : null;
    if (localId) {
      await prisma.knowledgeArticle.update({ where: { id: localId }, data: { parentId: localParent } }).catch(() => {});
    }
  }

  return { imported, skipped, errors };
}
