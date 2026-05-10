/**
 * Tiny S3 helper for the transcribe worker — only `getObject` (download
 * the LiveKit egress mp4 from MinIO) is needed.
 */

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

let _s3: S3Client | null = null;
function s3(): S3Client {
  if (_s3) return _s3;
  const endpoint = process.env.STORAGE_ENDPOINT?.trim() || undefined;
  const region = process.env.STORAGE_REGION?.trim() || 'us-east-1';
  const accessKeyId = process.env.STORAGE_ACCESS_KEY?.trim();
  const secretAccessKey = process.env.STORAGE_SECRET_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('STORAGE_ACCESS_KEY/STORAGE_SECRET_KEY missing');
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
  if (!b) throw new Error('STORAGE_BUCKET missing');
  return b;
}

export async function downloadObject(key: string): Promise<Buffer> {
  const out = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  if (!out.Body) throw new Error(`empty body for ${key}`);
  // Body is a Readable stream in Node — collect into Buffer.
  const stream = out.Body as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
