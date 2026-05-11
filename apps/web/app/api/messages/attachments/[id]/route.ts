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
  headers.set(
    'content-type',
    attachment.mimeType || stream.ContentType || 'application/octet-stream',
  );
  if (stream.ContentLength != null) {
    headers.set('content-length', String(stream.ContentLength));
  }
  if (stream.AcceptRanges) headers.set('accept-ranges', stream.AcceptRanges);
  if (stream.ContentRange) headers.set('content-range', stream.ContentRange);
  // Video notes are inline-played; downloads still use Content-Disposition.
  const safe = attachment.filename.replace(/[\r\n"]/g, '_');
  headers.set(
    'content-disposition',
    `inline; filename="${asciiFallback(safe)}"; filename*=UTF-8''${encodeURIComponent(safe)}`,
  );
  headers.set('cache-control', 'private, max-age=3600');

  const status = stream.ContentRange ? 206 : 200;
  return new Response(stream.Body as ReadableStream, { status, headers });
}

function asciiFallback(name: string): string {
  return name.replace(/[^\x20-\x7E]/g, '_');
}
