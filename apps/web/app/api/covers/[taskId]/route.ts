import { NextResponse } from 'next/server';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { canViewTask } from '@/lib/permissions';

/**
 * Stream a card's cover image to the viewer, gated by task visibility.
 *
 * Same rationale as the messenger attachment proxy: we never hand out
 * signed S3 URLs (they leak via history/referrer and outlive access
 * changes). Every byte goes through Next so view permission is re-checked
 * per request.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ taskId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const me = await requireAuth();
  const { taskId } = await params;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      creatorId: true,
      assigneeId: true,
      reviewerId: true,
      testerId: true,
      externalSource: true,
      coverImageKey: true,
      assignments: { select: { userId: true } },
      watchers: { select: { userId: true } },
      project: {
        select: { ownerId: true, members: { select: { userId: true, role: true } } },
      },
    },
  });
  if (!task || !task.coverImageKey) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  if (!canViewTask({ id: me.id, role: me.role }, task)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let stream;
  try {
    const { getObjectStream } = await import('@/lib/storage/s3');
    stream = await getObjectStream(task.coverImageKey);
  } catch {
    return NextResponse.json({ error: 'storage read failed' }, { status: 502 });
  }

  const headers = new Headers();
  headers.set('content-type', stream.ContentType || 'image/jpeg');
  if (stream.ContentLength != null) {
    headers.set('content-length', String(stream.ContentLength));
  }
  headers.set('content-disposition', 'inline');
  // Covers are immutable per key (we mint a fresh key on every change), so
  // they can be cached privately for a while without going stale.
  headers.set('cache-control', 'private, max-age=86400');

  return new Response(stream.Body as ReadableStream, { status: 200, headers });
}
