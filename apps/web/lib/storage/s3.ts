import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * S3-compatible storage adapter. Same code talks to MinIO in dev, R2 in
 * prod, AWS S3 if you ever need it — all are envelope-compatible behind
 * the @aws-sdk/client-s3 client.
 *
 * Required env (set in apps/web/.env.local):
 *   STORAGE_ENDPOINT     — http://localhost:9000 in dev, leave empty for AWS.
 *   STORAGE_REGION       — "us-east-1" works for MinIO + R2.
 *   STORAGE_ACCESS_KEY   — MinIO root user (dev) / R2 access key (prod).
 *   STORAGE_SECRET_KEY   — MinIO root password (dev) / R2 secret (prod).
 *   STORAGE_BUCKET       — bucket name. We use one bucket for all attachments.
 *   STORAGE_FORCE_PATH_STYLE — "1" for MinIO; R2 also wants this.
 */

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (_client) return _client;
  const endpoint = process.env.STORAGE_ENDPOINT?.trim() || undefined;
  const region = process.env.STORAGE_REGION?.trim() || 'us-east-1';
  const accessKeyId = process.env.STORAGE_ACCESS_KEY?.trim();
  const secretAccessKey = process.env.STORAGE_SECRET_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('STORAGE_ACCESS_KEY/STORAGE_SECRET_KEY not configured');
  }
  _client = new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === '1',
  });
  return _client;
}

function bucket(): string {
  const b = process.env.STORAGE_BUCKET?.trim();
  if (!b) throw new Error('STORAGE_BUCKET not configured');
  return b;
}

/**
 * Upload a file directly from server-side code (e.g. a server action
 * that received a multipart-form payload).
 */
export async function putObject(opts: {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
}): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: opts.key,
      Body: opts.body,
      ContentType: opts.contentType,
    }),
  );
}

/**
 * Pre-signed URL for direct browser download. Short TTL (5 min) — the
 * page re-renders fast enough that the user clicks within that window.
 *
 * For images / PDFs we serve through our /api/attachments/[id] proxy
 * to set Content-Disposition: inline, but for "Скачать" the signed
 * download URL is the cheapest path.
 */
export async function getSignedDownloadUrl(opts: {
  key: string;
  filename?: string;
  contentType?: string;
  ttlSeconds?: number;
}): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: bucket(),
    Key: opts.key,
    ...(opts.filename
      ? {
          ResponseContentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(
            opts.filename,
          )}`,
        }
      : {}),
    ...(opts.contentType ? { ResponseContentType: opts.contentType } : {}),
  });
  return getSignedUrl(getClient(), cmd, { expiresIn: opts.ttlSeconds ?? 300 });
}

export async function getObjectStream(key: string) {
  const res = await getClient().send(
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
  );
  return res;
}

export async function deleteObject(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: bucket(), Key: key }),
  );
}

/**
 * Build a deterministic, collision-free storage key for a new upload.
 * Format: `tasks/<taskId>/<YYYY/MM>/<random>-<safeName>`
 * Random prefix avoids overwrites if two uploads pick the same name in
 * the same minute. Date partitions keep folder listings sane.
 */
export function buildAttachmentKey(taskId: string, filename: string): string {
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
