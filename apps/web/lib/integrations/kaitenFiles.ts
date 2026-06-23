import { prisma } from '@giper/db';
import { KaitenClient } from '@giper/integrations/kaiten';
import { putObject, deleteObject, buildAttachmentKey } from '@/lib/storage/s3';

/**
 * Mirror Kaiten card files into task Attachments (download → our S3, so the file
 * survives even if Kaiten deletes it). One-way (Kaiten → giper-pm). externalId is
 * task-scoped (`${taskId}:${fileId}`) so the same board imported into two
 * projects keeps independent copies. Storage + download are injected so the sync
 * is unit-testable without S3 or network.
 */

const MAX_FILE_BYTES = 50 * 1024 * 1024; // skip files larger than 50 MB
const MAX_FILES_PER_TASK = 200;
const KAITEN_SOURCE = 'kaiten';

export type KaitenFileStorage = {
  putObject: (o: { key: string; body: Buffer; contentType: string }) => Promise<void>;
  deleteObject: (key: string) => Promise<void>;
  buildKey: (taskId: string, filename: string) => string;
  /** Fetch a public Kaiten file URL → bytes (or null to skip: too big / failed). */
  download: (url: string, declaredSize: number | null) => Promise<{ bytes: Buffer; contentType: string } | null>;
};

const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 3;

/** Only fetch from Kaiten's own file hosts — the URL comes from an API response,
 *  so this blocks SSRF to an internal/arbitrary host via a poisoned `url`. */
function isAllowedFileHost(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  return h === 'kaiten.ru' || h.endsWith('.kaiten.ru');
}

/** Fetch with manual redirect handling — every hop's host is re-validated so a
 *  redirect can't escape the *.kaiten.ru allowlist (SSRF defense). */
async function safeFetch(url: string, signal: AbortSignal): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedFileHost(current)) throw new Error('file url host not allowed');
    const res = await fetch(current, { redirect: 'manual', signal });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res;
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new Error('too many redirects');
}

const defaultDownload: KaitenFileStorage['download'] = async (url, declaredSize) => {
  if (declaredSize != null && declaredSize > MAX_FILE_BYTES) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await safeFetch(url, controller.signal);
    if (!res.ok) throw new Error(`download ${res.status}`);
    const len = Number(res.headers.get('content-length') ?? '');
    if (Number.isFinite(len) && len > MAX_FILE_BYTES) return null;
    const contentType = res.headers.get('content-type') || 'application/octet-stream';
    if (!res.body) {
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length > MAX_FILE_BYTES ? null : { bytes: buf, contentType };
    }
    // Stream with a hard cap on (already-decompressed) bytes, so a decompression
    // bomb or a lying Content-Length can't blow up memory.
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        if (total > MAX_FILE_BYTES) {
          controller.abort();
          return null;
        }
        chunks.push(value);
      }
    }
    return { bytes: Buffer.concat(chunks), contentType };
  } finally {
    clearTimeout(timer);
  }
};

export const defaultKaitenFileStorage: KaitenFileStorage = {
  putObject,
  deleteObject,
  buildKey: buildAttachmentKey,
  download: defaultDownload,
};

export type SyncKaitenFilesResult = { files: number; deleted: number; errors: string[] };

export async function syncKaitenFiles(
  client: KaitenClient,
  projectId: string,
  opts: { signal?: AbortSignal; storage?: KaitenFileStorage } = {},
): Promise<SyncKaitenFilesResult> {
  const storage = opts.storage ?? defaultKaitenFileStorage;
  const errors: string[] = [];
  let files = 0;
  let deleted = 0;

  const tasks = await prisma.task.findMany({
    where: { projectId, externalSource: KAITEN_SOURCE },
    select: { id: true, externalId: true },
  });

  for (const task of tasks) {
    if (opts.signal?.aborted) break;
    if (!task.externalId) continue;
    const cardId = Number(task.externalId);
    if (!Number.isFinite(cardId)) continue;

    let list;
    try {
      list = await client.listCardFiles(cardId);
    } catch (e) {
      errors.push(`files ${cardId}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (list.length > MAX_FILES_PER_TASK) {
      errors.push(`card ${cardId}: ${list.length} files > cap ${MAX_FILES_PER_TASK}, truncated`);
      list = list.slice(0, MAX_FILES_PER_TASK);
    }

    const keptIds = new Set<string>();
    for (const f of list) {
      if (f.deleted) continue;
      keptIds.add(String(f.id));
      const externalId = `${task.id}:${f.id}`;
      try {
        const existing = await prisma.attachment.findUnique({
          where: { externalSource_externalId: { externalSource: KAITEN_SOURCE, externalId } },
          select: { id: true },
        });
        if (existing) continue; // already mirrored — files are immutable in Kaiten
        const dl = await storage.download(f.url, f.size ?? null);
        if (!dl) {
          errors.push(`file ${f.id}: skipped (too large or unavailable)`);
          continue;
        }
        const filename = (f.name ?? '').trim() || `file-${f.id}`;
        const key = storage.buildKey(task.id, filename);
        await storage.putObject({ key, body: dl.bytes, contentType: f.mime_type || dl.contentType });
        try {
          await prisma.attachment.create({
            data: {
              taskId: task.id,
              filename,
              mimeType: f.mime_type || dl.contentType,
              sizeBytes: dl.bytes.length,
              storageKey: key,
              externalSource: KAITEN_SOURCE,
              externalId,
            },
          });
          files++;
        } catch (e) {
          // create failed (e.g. a concurrent sync won the unique race) — don't
          // leave the just-uploaded object orphaned in S3.
          await storage.deleteObject(key).catch(() => {});
          throw e;
        }
      } catch (e) {
        errors.push(`file ${f.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Reconcile deletions: drop local Kaiten attachments gone upstream.
    try {
      const local = await prisma.attachment.findMany({
        where: { taskId: task.id, externalSource: KAITEN_SOURCE },
        select: { id: true, externalId: true, storageKey: true },
      });
      const stale = local.filter((a) => {
        const fid = a.externalId?.split(':')[1];
        return fid && !keptIds.has(fid);
      });
      for (const a of stale) {
        if (a.storageKey) await storage.deleteObject(a.storageKey).catch(() => {});
      }
      if (stale.length) {
        await prisma.attachment.deleteMany({ where: { id: { in: stale.map((a) => a.id) } } });
        deleted += stale.length;
      }
    } catch (e) {
      errors.push(`files-reconcile ${cardId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { files, deleted, errors: errors.slice(0, 50) };
}
