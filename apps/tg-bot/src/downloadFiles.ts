/**
 * Listens on Redis pub/sub channel `tg:download-files` for a job posted
 * by the web app whenever a PM accepts an AI-proposed task that
 * references Telegram messages with attachments. We:
 *   1. Use the owning bot's grammY client to fetch the file metadata
 *      from Telegram (`bot.api.getFile`).
 *   2. Stream the content from Telegram CDN.
 *   3. Upload to MinIO (S3-compatible) at a deterministic key.
 *   4. Insert an `Attachment` row pointing at the new Task.
 */

import type { Bot } from 'grammy';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '@giper/db';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { tgFetch } from '@giper/shared/tgProxy';

export const DOWNLOAD_CHANNEL = 'tg:download-files';

export type DownloadJob = {
  botId: string;
  taskId: string;
  uploadedById: string;
  files: {
    telegramFileId: string;
    fileName: string;
    mimeType: string | null;
    sizeBytes: number | null;
    sourceMessageId: string;
  }[];
};

let _s3: S3Client | null = null;
function s3(): S3Client {
  if (_s3) return _s3;
  const endpoint = process.env.STORAGE_ENDPOINT?.trim() || undefined;
  const region = process.env.STORAGE_REGION?.trim() || 'us-east-1';
  const accessKeyId = process.env.STORAGE_ACCESS_KEY?.trim();
  const secretAccessKey = process.env.STORAGE_SECRET_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('STORAGE_ACCESS_KEY/STORAGE_SECRET_KEY not configured for tg-bot');
  }
  _s3 = new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === '1',
  });
  return _s3;
}

function bucket(): string {
  const b = process.env.STORAGE_BUCKET?.trim();
  if (!b) throw new Error('STORAGE_BUCKET not configured for tg-bot');
  return b;
}

function buildKey(taskId: string, filename: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 10);
  const safe = filename
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '_')
    .slice(0, 80);
  return `tasks/${taskId}/${yyyy}/${mm}/${rand}-${safe}`;
}

async function fetchTelegramFile(bot: Bot, telegramFileId: string): Promise<{ buffer: Buffer; size: number }> {
  const fileInfo = await bot.api.getFile(telegramFileId);
  if (!fileInfo.file_path) {
    throw new Error('Telegram getFile returned no file_path');
  }
  // grammY's `bot.api.config.apiRoot` defaults to https://api.telegram.org;
  // download URL pattern: https://api.telegram.org/file/bot<TOKEN>/<file_path>
  // We don't have direct access to the token here — but grammY exposes
  // `bot.api.raw` and `bot.token` is available on the Bot instance.
  const token = (bot as unknown as { token: string }).token;
  const url = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60_000);
  try {
    // tgFetch tunnels through TG_PROXY_URL when configured (RKN block).
    const res = await tgFetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      throw new Error(`Telegram CDN HTTP ${res.status}`);
    }
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    return { buffer: buf, size: buf.length };
  } finally {
    clearTimeout(t);
  }
}

async function processJob(
  prisma: PrismaClient,
  getBot: (botId: string) => Bot | undefined,
  job: DownloadJob,
): Promise<void> {
  const bot = getBot(job.botId);
  if (!bot) {
    // eslint-disable-next-line no-console
    console.warn(`[downloadFiles] bot ${job.botId} not running (yet?), skipping job for task ${job.taskId}`);
    return;
  }
  // Verify the task still exists.
  const task = await prisma.task.findUnique({ where: { id: job.taskId }, select: { id: true } });
  if (!task) {
    // eslint-disable-next-line no-console
    console.warn(`[downloadFiles] task ${job.taskId} gone, dropping ${job.files.length} files`);
    return;
  }

  for (const f of job.files) {
    try {
      const { buffer, size } = await fetchTelegramFile(bot, f.telegramFileId);
      const key = buildKey(job.taskId, f.fileName);
      const contentType = f.mimeType || 'application/octet-stream';
      await s3().send(
        new PutObjectCommand({
          Bucket: bucket(),
          Key: key,
          Body: buffer,
          ContentType: contentType,
        }),
      );
      await prisma.attachment.create({
        data: {
          taskId: job.taskId,
          filename: f.fileName,
          mimeType: contentType,
          sizeBytes: f.sizeBytes ?? size,
          storageKey: key,
          uploadedById: job.uploadedById,
        },
      });
      // eslint-disable-next-line no-console
      console.log(
        `[downloadFiles] task=${job.taskId} file=${f.fileName} (${size}b) uploaded to ${key}`,
      );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[downloadFiles] failed for task=${job.taskId} file=${f.fileName}`, e);
    }
  }
}

/**
 * Subscribe `subRedis` (must be a dedicated subscriber connection) to
 * the download channel and process jobs as they arrive.
 *
 * `getBot(botId)` gives us the running grammY Bot instance for the
 * bot that originally received the message — we need its token to
 * call Telegram's CDN.
 */
export async function startDownloadWorker(
  subRedis: Redis,
  prisma: PrismaClient,
  getBot: (botId: string) => Bot | undefined,
): Promise<void> {
  await subRedis.subscribe(DOWNLOAD_CHANNEL);
  subRedis.on('message', (channel, raw) => {
    if (channel !== DOWNLOAD_CHANNEL) return;
    let job: DownloadJob;
    try {
      job = JSON.parse(raw) as DownloadJob;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[downloadFiles] bad payload', raw.slice(0, 200), e);
      return;
    }
    if (!job.botId || !job.taskId || !Array.isArray(job.files)) {
      // eslint-disable-next-line no-console
      console.warn('[downloadFiles] missing fields', job);
      return;
    }
    processJob(prisma, getBot, job).catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[downloadFiles] processJob failed', e);
    });
  });
  // eslint-disable-next-line no-console
  console.log(`[downloadFiles] subscribed to ${DOWNLOAD_CHANNEL}`);
}
