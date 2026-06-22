import { NextResponse } from 'next/server';
import { prisma } from '@giper/db';
import { syncFigmaCommentsForFile } from '@/lib/figma/syncFigmaComments';
import { refreshDesignThumbnail } from '@/lib/figma/refreshDesignThumbnail';

/**
 * Figma webhook (v2) receiver. In Figma → team → webhooks, point a webhook at
 * this URL with passcode = FIGMA_WEBHOOK_PASSCODE. Handled events:
 *   PING          — creation handshake → 200
 *   FILE_COMMENT  — mirror the file's comments into linked tasks
 *   FILE_UPDATE / FILE_VERSION_UPDATE — refresh that file's design thumbnails
 *
 * Public: /api/webhooks/* skips the session middleware; auth is the passcode in
 * the payload. Best-effort handlers never throw back to Figma.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'bad json' }, { status: 400 });
  }

  const expected = process.env.FIGMA_WEBHOOK_PASSCODE?.trim();
  if (expected && body.passcode !== expected) {
    return NextResponse.json({ ok: false, error: 'bad passcode' }, { status: 401 });
  }

  const ev = String(body.event_type ?? '');
  if (ev === 'PING') return NextResponse.json({ ok: true });

  const fileKey = typeof body.file_key === 'string' ? body.file_key : null;
  if (!fileKey) return NextResponse.json({ ok: true });

  try {
    if (ev === 'FILE_COMMENT') {
      await syncFigmaCommentsForFile(fileKey);
    } else if (ev === 'FILE_UPDATE' || ev === 'FILE_VERSION_UPDATE') {
      const designs = await prisma.taskDesign.findMany({
        where: { fileKey },
        select: { id: true },
      });
      for (const d of designs) await refreshDesignThumbnail(d.id);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('figma webhook handler error', ev, fileKey, e);
  }
  return NextResponse.json({ ok: true });
}
