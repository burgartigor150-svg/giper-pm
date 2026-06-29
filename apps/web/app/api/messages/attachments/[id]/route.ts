import { NextResponse } from 'next/server';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { resolveChannelAccess } from '@/lib/messenger/access';

/**
 * Stream a MessageAttachment (video-note / file / etc.) to the viewer
 * with access gated by the parent channel's visibility.
 *
 * Why not signed S3 URLs:
 *   - Token URLs are bearer-style and leak to browser history,
 *     referrers, push notifications, and analytics.
 *   - Access is a function of the viewer's CURRENT channel
 *     membership, which can change. A 7-day signed URL would
 *     keep leaking content to a user we just removed from a
 *     PRIVATE channel.
 * So we proxy: every byte goes through Next, which re-checks the
 * channel access on each request.
 *
 * Range requests are forwarded to S3 via @aws-sdk so the browser
 * <video> can seek without buffering the whole 60s file.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Only these (attacker-uninteresting) types are served inline; everything else
// (html, svg, xml, office docs, unknown…) is forced to download as octet-stream
// so a mislabelled/hostile upload can't run scripts in our origin. Mirrors the
// task/KB attachment routes. Video/audio notes stay inline so the player works.
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

  const attachment = await prisma.messageAttachment.findUnique({
    where: { id },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      storageKey: true,
      kind: true,
      message: { select: { channelId: true } },
    },
  });
  if (!attachment) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const access = await resolveChannelAccess(attachment.message.channelId, me.id);
  if (!access || !access.canRead) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Forward Range so <video> seek works.
  const range = req.headers.get('range') ?? undefined;
  let stream;
  try {
    const { getObjectStream } = await import('@/lib/storage/s3');
    stream = await getObjectStream(attachment.storageKey, { range });
  } catch {
    return NextResponse.json({ error: 'storage read failed' }, { status: 502 });
  }

  const headers = new Headers();
  const mime = attachment.mimeType || stream.ContentType || 'application/octet-stream';
  const inline = isInlineSafe(mime);
  // Unsafe mimes (svg/html/xml/office/unknown) are forced to download as
  // octet-stream so a hostile upload can't execute in our origin.
  headers.set('content-type', inline ? mime : 'application/octet-stream');
  if (stream.ContentLength != null) {
    headers.set('content-length', String(stream.ContentLength));
  }
  if (stream.AcceptRanges) headers.set('accept-ranges', stream.AcceptRanges);
  if (stream.ContentRange) headers.set('content-range', stream.ContentRange);
  // Inline for media (video/audio notes, images, pdf); attachment otherwise.
  const safe = attachment.filename.replace(/[\r\n"]/g, '_');
  headers.set(
    'content-disposition',
    `${inline ? 'inline' : 'attachment'}; filename="${asciiFallback(safe)}"; filename*=UTF-8''${encodeURIComponent(safe)}`,
  );
  headers.set('x-content-type-options', 'nosniff');
  if (!inline) headers.set('content-security-policy', "default-src 'none'; sandbox");
  headers.set('cache-control', 'private, max-age=3600');

  const status = stream.ContentRange ? 206 : 200;
  return new Response(stream.Body as ReadableStream, { status, headers });
}

function asciiFallback(name: string): string {
  return name.replace(/[^\x20-\x7E]/g, '_');
}
