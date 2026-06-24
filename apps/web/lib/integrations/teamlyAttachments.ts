import { prisma } from '@giper/db';
import type { TeamlyClient } from '@giper/integrations/teamly';
import { putObject, deleteObject, buildKbAttachmentKey } from '@/lib/storage/s3';

/**
 * T4 — localize TEAMLY-hosted images embedded in mirrored KB articles. The
 * ProseMirror→markdown converter (T1) keeps a TEAMLY image as `![alt](src)`;
 * when `src` is a SAME-ORIGIN relative path (e.g. `/attachments/download/123/x.png`)
 * it's unreachable from giper-pm (it would resolve against our domain, not
 * TEAMLY's, and needs TEAMLY auth) → a broken image. This pass downloads each
 * such file to our S3, records a KnowledgeAttachment, and rewrites the article
 * content to point at our serve route (`/api/knowledge/attachments/<id>`).
 *
 * Absolute/external `src` (a public CDN, googleusercontent, …) renders fine and
 * is left untouched — localizing arbitrary hosts would add SSRF surface.
 *
 * One-way (TEAMLY → giper-pm), idempotent: `KnowledgeAttachment.externalId`
 * (`<articleId>:<relativeUrl>`) dedupes so a re-sync reuses the stored file
 * instead of re-downloading; images removed upstream are reconciled away.
 * Runs AFTER runTeamlySync (which re-writes the TEAMLY-relative urls each cycle).
 */

const SOURCE = 'teamly';
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per image
/** Distinct images scanned per article — a sanity bound (reconcile keep-set). */
const SCAN_CAP = 1000;
/** NEW files downloaded per article per run; the rest defer to the next sync
 *  (already-localized images are always re-used, not re-counted). */
const MAX_NEW_DOWNLOADS = 200;
/** Articles processed per run — backstop against an unbounded mirror. */
const MAX_ARTICLES = 20_000;
const LOCAL_PREFIX = '/api/knowledge/attachments/';

/** Markdown image with a relative target: `![alt](/path)`. Excludes absolute
 *  (`http…`), protocol-relative (`//…`) and titled (`(/p "t")`) forms. */
const IMG_RE = /!\[([^\]]*)\]\((\/[^)\s]+)\)/g;

export type TeamlyAttachmentStorage = {
  putObject: (o: { key: string; body: Buffer; contentType: string }) => Promise<void>;
  deleteObject: (key: string) => Promise<void>;
  buildKey: (articleId: string, filename: string) => string;
};

export const defaultTeamlyAttachmentStorage: TeamlyAttachmentStorage = {
  putObject,
  deleteObject,
  buildKey: buildKbAttachmentKey,
};

function filenameFromUrl(url: string): string {
  try {
    const clean = url.split('?')[0]!.split('#')[0]!;
    const base = decodeURIComponent(clean.split('/').filter(Boolean).pop() ?? '');
    return (base || 'image').slice(0, 200);
  } catch {
    return 'image';
  }
}

export type SyncTeamlyAttachmentsResult = {
  downloaded: number;
  reused: number;
  pruned: number;
  errors: string[];
};

export async function syncTeamlyAttachments(
  client: Pick<TeamlyClient, 'downloadFile'>,
  opts: { signal?: AbortSignal; storage?: TeamlyAttachmentStorage } = {},
): Promise<SyncTeamlyAttachmentsResult> {
  const storage = opts.storage ?? defaultTeamlyAttachmentStorage;
  const errors: string[] = [];
  let downloaded = 0;
  let reused = 0;
  let pruned = 0;

  // Prefilter to articles that contain a relative markdown target.
  const articles = await prisma.knowledgeArticle.findMany({
    where: { externalSource: SOURCE, content: { contains: '](/' } },
    select: { id: true, content: true },
    take: MAX_ARTICLES,
  });

  for (const article of articles) {
    if (opts.signal?.aborted) break;
    const content = article.content ?? '';

    // Distinct relative image urls still pointing at TEAMLY (skip already-local).
    const urls: string[] = [];
    const seenUrls = new Set<string>();
    for (const m of content.matchAll(IMG_RE)) {
      const url = m[2]!;
      if (url.startsWith(LOCAL_PREFIX) || url.startsWith('//')) continue;
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);
      urls.push(url);
      if (urls.length >= SCAN_CAP) break;
    }
    if (urls.length === 0) continue;

    // Reconcile keep-set = EVERY referenced relative url (NOT capped by the
    // per-run download budget), so a >cap article never prunes images it still
    // references; the download budget only defers NEW fetches to a later sync.
    const seenExternalIds = new Set(urls.map((u) => `${article.id}:${u}`));
    const localByUrl = new Map<string, string>(); // relative url → attachment id
    let newDownloads = 0;

    for (const url of urls) {
      if (opts.signal?.aborted) break;
      const externalId = `${article.id}:${url}`;
      try {
        const existing = await prisma.knowledgeAttachment.findUnique({
          where: { externalSource_externalId: { externalSource: SOURCE, externalId } },
          select: { id: true },
        });
        if (existing) {
          localByUrl.set(url, existing.id);
          reused++;
          continue;
        }
        if (newDownloads >= MAX_NEW_DOWNLOADS) continue; // defer to the next sync
        newDownloads++;
        const dl = await client.downloadFile(url, { maxBytes: MAX_FILE_BYTES });
        if (!dl) {
          errors.push(`img ${url}: unavailable or too large`);
          continue;
        }
        const filename = filenameFromUrl(url);
        const key = storage.buildKey(article.id, filename);
        await storage.putObject({ key, body: dl.bytes, contentType: dl.contentType });
        try {
          const created = await prisma.knowledgeAttachment.create({
            data: {
              articleId: article.id,
              filename,
              mimeType: dl.contentType,
              sizeBytes: dl.bytes.length,
              storageKey: key,
              externalSource: SOURCE,
              externalId,
            },
            select: { id: true },
          });
          localByUrl.set(url, created.id);
          downloaded++;
        } catch (e) {
          // Don't orphan the just-uploaded object; adopt a row a concurrent sync
          // may have won the unique race with.
          await storage.deleteObject(key).catch(() => {});
          const adopt = await prisma.knowledgeAttachment.findUnique({
            where: { externalSource_externalId: { externalSource: SOURCE, externalId } },
            select: { id: true },
          });
          if (adopt) {
            localByUrl.set(url, adopt.id);
            reused++;
          } else {
            throw e;
          }
        }
      } catch (e) {
        errors.push(`img ${url}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Rewrite the relative image targets → our serve route.
    if (localByUrl.size > 0) {
      const rewritten = content.replace(IMG_RE, (whole, alt: string, url: string) => {
        const id = localByUrl.get(url);
        return id ? `![${alt}](${LOCAL_PREFIX}${id})` : whole;
      });
      if (rewritten !== content) {
        try {
          await prisma.knowledgeArticle.update({
            where: { id: article.id },
            data: { content: rewritten },
          });
        } catch (e) {
          errors.push(`rewrite ${article.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    // Reconcile: drop this article's teamly attachments no longer referenced.
    try {
      const local = await prisma.knowledgeAttachment.findMany({
        where: { articleId: article.id, externalSource: SOURCE },
        select: { id: true, externalId: true, storageKey: true },
      });
      const stale = local.filter((a) => a.externalId && !seenExternalIds.has(a.externalId));
      for (const a of stale) {
        if (a.storageKey) await storage.deleteObject(a.storageKey).catch(() => {});
      }
      if (stale.length) {
        await prisma.knowledgeAttachment.deleteMany({ where: { id: { in: stale.map((a) => a.id) } } });
        pruned += stale.length;
      }
    } catch (e) {
      errors.push(`reconcile ${article.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { downloaded, reused, pruned, errors: errors.slice(0, 50) };
}
