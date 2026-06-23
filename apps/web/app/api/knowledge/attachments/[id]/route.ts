import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { getSpaceAccessById } from '@/lib/knowledge/access';
import { getObjectStream } from '@/lib/storage/s3';

/**
 * GET /api/knowledge/attachments/:id — stream a KB article attachment from S3.
 * Session-authenticated; requires canView on the article's space. Content is
 * served inline (images/PDF render in-browser) with Range support; the filename
 * uses RFC 5987 for non-ASCII names.
 */
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

function asciiFallback(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, '_') || 'file';
}

// Only these (attacker-uninteresting) types are served inline; everything else
// (html, svg, xml, office docs, unknown…) is forced to download as octet-stream
// so a malicious upload can't execute as stored XSS in the app origin.
const SAFE_INLINE = new Set(['application/pdf', 'text/plain', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']);
function isInlineSafe(mime: string): boolean {
  return SAFE_INLINE.has(mime) || mime.startsWith('video/') || mime.startsWith('audio/');
}

export async function GET(req: Request, { params }: Ctx) {
  let me: Awaited<ReturnType<typeof requireAuth>>;
  try {
    me = await requireAuth();
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }
  const { id } = await params;

  const att = await prisma.knowledgeAttachment.findUnique({
    where: { id },
    select: {
      filename: true,
      mimeType: true,
      storageKey: true,
      article: { select: { spaceId: true } },
    },
  });
  if (!att || !att.storageKey) return new Response('Not found', { status: 404 });
  const acc = await getSpaceAccessById(me, att.article.spaceId);
  if (!acc.canView) return new Response('Not found', { status: 404 }); // don't leak existence

  try {
    const range = req.headers.get('range') ?? undefined;
    const res = await getObjectStream(att.storageKey, { range });
    const inline = isInlineSafe(att.mimeType);
    const headers = new Headers();
    headers.set('content-type', inline ? att.mimeType : 'application/octet-stream');
    if (res.ContentLength != null) headers.set('content-length', String(res.ContentLength));
    if (res.ContentRange) headers.set('content-range', res.ContentRange);
    headers.set('accept-ranges', 'bytes');
    headers.set(
      'content-disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${asciiFallback(att.filename)}"; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
    );
    // Defense in depth: never let the browser MIME-sniff, and sandbox any
    // non-inline document so even a mislabelled HTML/SVG can't run scripts.
    headers.set('x-content-type-options', 'nosniff');
    if (!inline) headers.set('content-security-policy', "default-src 'none'; sandbox");
    headers.set('cache-control', 'private, max-age=300');
    return new Response(res.Body as ReadableStream, { status: res.ContentRange ? 206 : 200, headers });
  } catch (e) {
    // A row pointing at an object removed out-of-band (lifecycle/manual) → 404.
    const code = (e as { name?: string; $metadata?: { httpStatusCode?: number } } | null);
    if (code?.name === 'NoSuchKey' || code?.$metadata?.httpStatusCode === 404) {
      return new Response('Not found', { status: 404 });
    }
    console.error('[kb-attachment] storage read failed', att.storageKey, e);
    return new Response('Storage read failed', { status: 502 });
  }
}
