import { NextResponse } from 'next/server';
import { prisma } from '@giper/db';
import { bitrix24DownloadUrl } from '@giper/integrations/bitrix24';
import { requireAuth } from '@/lib/auth';
import { canViewTask } from '@/lib/permissions';
import { DomainError } from '@/lib/errors';

/**
 * Proxy a single attachment from the source-of-truth (currently only
 * Bitrix24) to the browser, rewriting Content-Disposition so PDFs and
 * images render inline instead of forcing a download. Two reasons we
 * must proxy rather than redirect:
 *
 *   1. The Bitrix download URL embeds the webhook token. Redirecting
 *      would expose it to the user-agent and any caching middleboxes.
 *   2. Bitrix returns `Content-Disposition: attachment`; we need to
 *      rewrite to `inline` so <iframe> / <img> previews work.
 *
 * Permission: same as viewing the parent task. We always re-check —
 * never trust the id alone.
 *
 * Range requests are forwarded so PDF.js can do byte-range loading and
 * <video> can seek without buffering the whole file.
 */
export const dynamic = 'force-dynamic';

// Only these (attacker-uninteresting) types are served inline; everything else
// (html, svg, xml, office docs, unknown…) is forced to download as octet-stream
// so a mislabelled/hostile file from any source (user upload, Bitrix, Kaiten)
// can't run scripts in our origin. Mirrors the KB attachment route.
const SAFE_INLINE = new Set([
  'application/pdf',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);
function isInlineSafe(mime: string): boolean {
  return SAFE_INLINE.has(mime) || mime.startsWith('video/') || mime.startsWith('audio/');
}

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const me = await requireAuth();
  const { id } = await params;

  const attachment = await prisma.attachment.findUnique({
    where: { id },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      storageKey: true,
      externalSource: true,
      externalId: true,
      task: {
        select: {
          creatorId: true,
          assigneeId: true,
          externalSource: true,
          project: {
            select: {
              ownerId: true,
              members: { select: { userId: true, role: true } },
            },
          },
        },
      },
    },
  });
  if (!attachment) return notFound();

  if (!canViewTask({ id: me.id, role: me.role }, attachment.task)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // S3-backed path: local uploads (externalSource null) AND mirrored sources we
  // download into our own bucket (Kaiten). Stream from S3 with our own
  // Content-Disposition so the user-agent never sees S3 credentials.
  if (
    (attachment.externalSource == null || attachment.externalSource === 'kaiten') &&
    attachment.storageKey &&
    attachment.storageKey !== ''
  ) {
    const { getObjectStream } = await import('@/lib/storage/s3');
    let res;
    try {
      res = await getObjectStream(attachment.storageKey);
    } catch {
      return NextResponse.json({ error: 'storage read failed' }, { status: 502 });
    }
    const headers = new Headers();
    const mime = attachment.mimeType || res.ContentType || 'application/octet-stream';
    const inline = isInlineSafe(mime);
    headers.set('content-type', inline ? mime : 'application/octet-stream');
    if (res.ContentLength != null) {
      headers.set('content-length', String(res.ContentLength));
    }
    const safe = attachment.filename.replace(/[\r\n"]/g, '_');
    headers.set(
      'content-disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${asciiFallback(safe)}"; filename*=UTF-8''${encodeURIComponent(safe)}`,
    );
    headers.set('x-content-type-options', 'nosniff');
    if (!inline) headers.set('content-security-policy', "default-src 'none'; sandbox");
    headers.set('cache-control', 'private, max-age=300');
    // res.Body is a Readable / ReadableStream depending on runtime;
    // Response accepts both.
    return new Response(res.Body as ReadableStream, { status: 200, headers });
  }

  if (attachment.externalSource !== 'bitrix24' || !attachment.externalId) {
    return NextResponse.json({ error: 'unsupported source' }, { status: 501 });
  }

  const webhook = process.env.BITRIX24_WEBHOOK_URL;
  if (!webhook) {
    throw new DomainError(
      'VALIDATION',
      500,
      'BITRIX24_WEBHOOK_URL is not configured',
    );
  }
  const upstreamUrl = bitrix24DownloadUrl(webhook, attachment.externalId);
  if (!upstreamUrl) {
    return NextResponse.json({ error: 'cannot build upstream url' }, { status: 500 });
  }

  // Forward Range so PDF.js / <video> seek works.
  const upstreamHeaders: HeadersInit = {};
  const range = req.headers.get('range');
  if (range) upstreamHeaders.range = range;

  const upstream = await fetch(upstreamUrl, { headers: upstreamHeaders });
  if (!upstream.ok && upstream.status !== 206) {
    return NextResponse.json(
      { error: 'upstream failed', status: upstream.status },
      { status: 502 },
    );
  }

  const headers = new Headers();
  // Use the local-row mimeType (we already guess from extension at sync
  // time). Bitrix's own Content-Type is often application/octet-stream.
  const mime = attachment.mimeType || 'application/octet-stream';
  const inline = isInlineSafe(mime);
  headers.set('content-type', inline ? mime : 'application/octet-stream');
  const len = upstream.headers.get('content-length');
  if (len) headers.set('content-length', len);
  const acceptRanges = upstream.headers.get('accept-ranges');
  if (acceptRanges) headers.set('accept-ranges', acceptRanges);
  const contentRange = upstream.headers.get('content-range');
  if (contentRange) headers.set('content-range', contentRange);
  // RFC 5987 — the filename is Cyrillic for our portal, so we always
  // emit the encoded form alongside an ASCII fallback.
  const safe = attachment.filename.replace(/[\r\n"]/g, '_');
  headers.set(
    'content-disposition',
    `${inline ? 'inline' : 'attachment'}; filename="${asciiFallback(safe)}"; filename*=UTF-8''${encodeURIComponent(safe)}`,
  );
  headers.set('x-content-type-options', 'nosniff');
  if (!inline) headers.set('content-security-policy', "default-src 'none'; sandbox");
  // No CDN caching: URLs embed our token via the upstream and access depends
  // on the viewer's session. Browser cache is fine for the session.
  headers.set('cache-control', 'private, max-age=300');

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}

function notFound() {
  return NextResponse.json({ error: 'not found' }, { status: 404 });
}

function asciiFallback(name: string): string {
  return name.replace(/[^\x20-\x7E]/g, '_');
}
