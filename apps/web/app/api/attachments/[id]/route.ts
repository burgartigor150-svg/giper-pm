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

  // Local upload path: stream straight from S3 with our own
  // Content-Disposition. We pull the object server-side and pipe back
  // so the user-agent never sees S3 credentials or pre-signed URLs.
  if (
    attachment.externalSource == null &&
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
    headers.set(
      'content-type',
      attachment.mimeType || res.ContentType || 'application/octet-stream',
    );
    if (res.ContentLength != null) {
      headers.set('content-length', String(res.ContentLength));
    }
    const safe = attachment.filename.replace(/[\r\n"]/g, '_');
    headers.set(
      'content-disposition',
      `inline; filename="${asciiFallback(safe)}"; filename*=UTF-8''${encodeURIComponent(safe)}`,
    );
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
  headers.set('content-type', attachment.mimeType || 'application/octet-stream');
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
    `inline; filename="${asciiFallback(safe)}"; filename*=UTF-8''${encodeURIComponent(safe)}`,
  );
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
