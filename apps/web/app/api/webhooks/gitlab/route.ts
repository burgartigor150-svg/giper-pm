import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { handleMergeRequest, handlePush } from '@/lib/integrations/gitlab/handlers';
import { publishTaskEvent } from '@/lib/realtime/publishTask';

/**
 * GitLab webhook receiver. Configure in the project (or group) under
 * Settings → Webhooks:
 *   URL:    https://<our-host>/api/webhooks/gitlab
 *   Secret token: GITLAB_WEBHOOK_SECRET (env)
 *   Triggers: Push events + Merge request events
 *
 * Auth: GitLab can't sign the body like GitHub — it sends the shared
 * secret verbatim in the `X-Gitlab-Token` header. We compare it in
 * constant time. Dispatch is by `object_kind` in the body (more reliable
 * than the X-Gitlab-Event header). Unknown kinds are acked, not 4xx'd.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function tokenOk(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const secret = process.env.GITLAB_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'not configured' }, { status: 503 });
  }

  const token = req.headers.get('x-gitlab-token') ?? '';
  if (!tokenOk(token, secret)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let payload: { object_kind?: string };
  try {
    payload = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ ok: false, error: 'bad json' }, { status: 400 });
  }

  const kind = payload.object_kind ?? '';

  try {
    if (kind === 'push') {
      const result = await handlePush(payload as Parameters<typeof handlePush>[0]);
      revalidatePath('/');
      return NextResponse.json({ ok: true, kind, ...result });
    }

    if (kind === 'merge_request') {
      const result = await handleMergeRequest(
        payload as Parameters<typeof handleMergeRequest>[0],
      );
      // Pulse task channels so the MR badge shows live on open task pages.
      const p = payload as {
        project?: { path_with_namespace?: string };
        object_attributes?: { iid?: number };
      };
      const links = await prisma.taskPullRequest.findMany({
        where: {
          provider: 'gitlab',
          repo: p.project?.path_with_namespace,
          number: p.object_attributes?.iid,
        },
        select: { taskId: true },
      });
      for (const l of links) {
        void publishTaskEvent(l.taskId, { type: 'task:pr-updated', taskId: l.taskId });
      }
      return NextResponse.json({ ok: true, kind, ...result });
    }

    // Unknown / unhandled kind (note events, pipeline, the test push, …).
    return NextResponse.json({ ok: true, kind, action: 'ignored' });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('gitlab webhook error', kind, e);
    return NextResponse.json(
      { ok: false, kind, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
