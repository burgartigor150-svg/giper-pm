import type { PrismaClient } from '@giper/db';
import { Bitrix24Client } from './client';

export type SyncFilesResult = {
  /** Attachments seen across all tasks during this run. */
  totalSeen: number;
  /** New Attachment rows written. */
  created: number;
  /** Existing Attachment rows whose name/size changed. */
  updated: number;
  /** Local rows removed because the corresponding attachment is gone in Bitrix. */
  deleted: number;
  errors: number;
};

type AttachedObject = {
  ID: string;
  NAME: string;
  SIZE: string | number;
  CREATED_BY?: string;
  CREATE_TIME?: string;
};

/**
 * Pull task-level attachments for one task from Bitrix24 and upsert into
 * the local Attachment table.
 *
 * Source of truth: the task's `ufTaskWebdavFiles` array gives us the
 * `disk.attachedObject` ids; for each we GET that record to learn
 * NAME/SIZE/CREATE_TIME. The download URL is NOT stored — it embeds the
 * incoming-webhook token, so a webhook rotation would invalidate every
 * stored link. We rebuild it at request time in `bitrix24FileUrl()`.
 */
export async function syncTaskAttachments(
  prisma: PrismaClient,
  client: Bitrix24Client,
  task: { id: string; bitrixTaskId: string; attachmentIds: string[] },
  stats: SyncFilesResult,
): Promise<void> {
  const remoteIds = new Set(task.attachmentIds.map(String));

  // Drop local rows that no longer exist on the Bitrix side.
  if (remoteIds.size === 0) {
    const removed = await prisma.attachment.deleteMany({
      where: { taskId: task.id, externalSource: 'bitrix24' },
    });
    stats.deleted += removed.count;
    return;
  }
  const stale = await prisma.attachment.findMany({
    where: { taskId: task.id, externalSource: 'bitrix24' },
    select: { id: true, externalId: true },
  });
  const toDelete = stale.filter((a) => a.externalId && !remoteIds.has(a.externalId));
  if (toDelete.length > 0) {
    await prisma.attachment.deleteMany({
      where: { id: { in: toDelete.map((a) => a.id) } },
    });
    stats.deleted += toDelete.length;
  }

  for (const id of remoteIds) {
    stats.totalSeen++;
    try {
      const obj = await fetchAttachedObject(client, id);
      if (!obj) {
        // Attachment no longer fetchable (deleted in Bitrix or perms).
        // Fall through — the next stale-cleanup pass will catch it on
        // the following run when it disappears from the task too.
        continue;
      }
      await upsertAttachment(prisma, task.id, obj, stats);
    } catch (e) {
      stats.errors++;
      // eslint-disable-next-line no-console
      console.error('bitrix24 syncFiles: failed to upsert attachment', id, e);
    }
  }
}

async function fetchAttachedObject(
  client: Bitrix24Client,
  id: string,
): Promise<AttachedObject | null> {
  try {
    const res = await client.call<AttachedObject>('disk.attachedObject.get', { id });
    return res.result ?? null;
  } catch (e) {
    // 404 / permission — treat as "gone" for sync purposes.
    if (e instanceof Error && /NOT_FOUND|access/i.test(e.message)) return null;
    throw e;
  }
}

async function upsertAttachment(
  prisma: PrismaClient,
  taskId: string,
  obj: AttachedObject,
  stats: SyncFilesResult,
): Promise<void> {
  const sizeBytes = Number(obj.SIZE) || 0;
  const filename = obj.NAME ?? `attachment-${obj.ID}`;
  const mimeType = guessMime(filename);

  const existing = await prisma.attachment.findUnique({
    where: {
      externalSource_externalId: { externalSource: 'bitrix24', externalId: obj.ID },
    },
    select: { id: true, filename: true, sizeBytes: true, mimeType: true, taskId: true },
  });

  if (existing) {
    if (
      existing.filename !== filename ||
      existing.sizeBytes !== sizeBytes ||
      existing.mimeType !== mimeType ||
      existing.taskId !== taskId
    ) {
      await prisma.attachment.update({
        where: { id: existing.id },
        data: { filename, sizeBytes, mimeType, taskId },
      });
      stats.updated++;
    }
    return;
  }

  await prisma.attachment.create({
    data: {
      taskId,
      filename,
      mimeType,
      sizeBytes,
      storageKey: '', // mirrored — URL is rebuilt at request time
      uploadedById: null,
      externalSource: 'bitrix24',
      externalId: obj.ID,
      uploadedAt: obj.CREATE_TIME ? new Date(obj.CREATE_TIME) : new Date(),
    },
  });
  stats.created++;
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function guessMime(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  return (ext && MIME_BY_EXT[ext]) || 'application/octet-stream';
}

/**
 * Build a one-shot download URL for a mirrored attachment. The URL is built
 * from the live webhook URL plus the attached-object id, mirroring the
 * shape Bitrix returns from `disk.attachedObject.get` itself. We don't
 * persist URLs because they embed the webhook secret.
 */
export function bitrix24DownloadUrl(webhookUrl: string, attachmentId: string): string | null {
  try {
    const u = new URL(webhookUrl);
    // webhookUrl is like https://giper.bitrix24.ru/rest/<userId>/<token>/
    const segments = u.pathname.split('/').filter(Boolean); // ['rest', userId, token]
    const userId = segments[1];
    const token = segments[2];
    if (!userId || !token) return null;
    const params = new URLSearchParams({
      attachedId: attachmentId,
      'auth[aplogin]': userId,
      'auth[ap]': token,
      action: 'download',
      ncc: '1',
    });
    return `${u.protocol}//${u.host}/bitrix/tools/disk/uf.php?${params.toString()}`;
  } catch {
    return null;
  }
}
