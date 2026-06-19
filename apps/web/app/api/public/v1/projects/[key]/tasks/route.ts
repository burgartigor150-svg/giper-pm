import { NextResponse } from 'next/server';
import { resolveApiToken } from '@/lib/api/resolveApiToken';
import { listTasksForBoard } from '@/lib/tasks/listTasksForBoard';
import { DomainError } from '@/lib/errors';

/**
 * GET /api/public/v1/projects/:key/tasks — tasks in a project, scoped to the
 * token owner's visibility (same query the board uses). Read-only.
 */
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ key: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const user = await resolveApiToken(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const { key } = await params;

  try {
    const { project, tasks } = await listTasksForBoard(key, {}, user);
    return NextResponse.json({
      ok: true,
      data: {
        project: { key: project.key, name: project.name },
        tasks: tasks.map((t) => ({
          number: t.number,
          title: t.title,
          status: t.status,
          internalStatus: t.internalStatus,
          priority: t.priority,
          type: t.type,
          storyPoints: t.storyPoints,
          assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.name } : null,
        })),
      },
    });
  } catch (e) {
    if (e instanceof DomainError) {
      const status = e.code === 'NOT_FOUND' ? 404 : e.code === 'INSUFFICIENT_PERMISSIONS' ? 403 : 400;
      return NextResponse.json({ ok: false, error: e.code.toLowerCase() }, { status });
    }
    throw e;
  }
}
