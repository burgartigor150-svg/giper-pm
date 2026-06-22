import { prisma, type PullRequestState } from '@giper/db';
import { parseTaskRefs } from '../github/parseRefs';

/**
 * GitLab webhook payload handlers — the GitLab counterpart to the GitHub
 * handlers. Same linkage model: a `KEY-N` reference in a commit message,
 * MR title/description, or source branch links the commit/MR to the task.
 *
 * GitLab differs from GitHub in payload shape:
 *   - Push:          object_kind='push',  project.path_with_namespace, commits[]
 *   - Merge request: object_kind='merge_request', object_attributes{ iid, … }
 *
 * Idempotency mirrors GitHub:
 *   - Commit comments deduped by (externalSource='gitlab', externalId=commit:<sha>)
 *   - MRs upserted by (repo, number, taskId) on TaskPullRequest (provider='gitlab')
 */

async function resolveTaskIds(
  refs: { projectKey: string; number: number }[],
): Promise<{ id: string; key: string; number: number }[]> {
  if (refs.length === 0) return [];
  const projectKeys = Array.from(new Set(refs.map((r) => r.projectKey)));
  const projects = await prisma.project.findMany({
    where: { key: { in: projectKeys } },
    select: { id: true, key: true },
  });
  const projectByKey = new Map(projects.map((p) => [p.key, p]));

  const out: { id: string; key: string; number: number }[] = [];
  for (const ref of refs) {
    const proj = projectByKey.get(ref.projectKey);
    if (!proj) continue;
    const t = await prisma.task.findUnique({
      where: { projectId_number: { projectId: proj.id, number: ref.number } },
      select: { id: true, number: true },
    });
    if (t) out.push({ id: t.id, key: proj.key, number: t.number });
  }
  return out;
}

type GitLabCommit = {
  id?: string;
  message?: string;
  url?: string;
  author?: { name?: string; email?: string };
};
type PushPayload = {
  object_kind?: string;
  ref?: string;
  project?: { path_with_namespace?: string; web_url?: string };
  commits?: GitLabCommit[];
  user_name?: string;
};

export async function handlePush(payload: PushPayload): Promise<{
  matched: number;
  comments: number;
}> {
  const repo = payload.project?.path_with_namespace ?? '';
  const repoUrl = payload.project?.web_url ?? '';
  const commits = payload.commits ?? [];

  let comments = 0;
  let matched = 0;

  for (const c of commits) {
    if (!c.id || !c.message) continue;
    const refs = parseTaskRefs(c.message);
    if (refs.length === 0) continue;
    matched++;
    const tasks = await resolveTaskIds(refs);

    for (const task of tasks) {
      const externalId = `commit:${c.id}`;
      const existing = await prisma.comment.findUnique({
        where: {
          externalSource_externalId: { externalSource: 'gitlab', externalId },
        },
        select: { id: true },
      });
      if (existing) continue; // webhook redelivery

      const fallback = await prisma.user.findFirst({
        where: { role: 'ADMIN', isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!fallback) continue;

      const shortSha = c.id.slice(0, 8);
      const author = c.author?.name || payload.user_name || 'кто-то';
      const link = c.url || `${repoUrl}/-/commit/${c.id}`;
      const body = `🔧 ${author} закоммитил [${shortSha}](${link}) в ${repo}\n\n> ${c.message
        .split('\n')[0]!
        .slice(0, 200)}`;

      await prisma.comment.create({
        data: {
          taskId: task.id,
          authorId: fallback.id,
          body,
          source: 'GITLAB',
          visibility: 'INTERNAL',
          externalSource: 'gitlab',
          externalId,
        },
      });
      comments++;
    }
  }

  return { matched, comments };
}

type MergeRequestPayload = {
  object_kind?: string;
  object_attributes?: {
    iid?: number;
    title?: string;
    description?: string | null;
    state?: 'opened' | 'closed' | 'locked' | 'merged';
    source_branch?: string;
    target_branch?: string;
    url?: string;
    draft?: boolean;
    work_in_progress?: boolean;
    merged_at?: string | null;
  };
  project?: { path_with_namespace?: string };
  user?: { username?: string };
};

function deriveState(
  attrs: NonNullable<MergeRequestPayload['object_attributes']>,
): PullRequestState {
  if (attrs.state === 'merged') return 'MERGED';
  if (attrs.state === 'closed' || attrs.state === 'locked') return 'CLOSED';
  if (attrs.draft || attrs.work_in_progress) return 'DRAFT';
  return 'OPEN';
}

export async function handleMergeRequest(
  payload: MergeRequestPayload,
): Promise<{ matched: number; upserted: number }> {
  const a = payload.object_attributes;
  const repo = payload.project?.path_with_namespace;
  if (!a || !repo || a.iid == null || !a.title || !a.url) {
    return { matched: 0, upserted: 0 };
  }

  const haystack = [a.title, a.description ?? '', a.source_branch ?? ''].join(' ');
  const refs = parseTaskRefs(haystack);
  if (refs.length === 0) return { matched: 0, upserted: 0 };

  const tasks = await resolveTaskIds(refs);
  const state = deriveState(a);
  const mergedAt = a.merged_at ? new Date(a.merged_at) : null;

  let upserted = 0;
  for (const task of tasks) {
    await prisma.taskPullRequest.upsert({
      where: { repo_number_taskId: { repo, number: a.iid, taskId: task.id } },
      create: {
        taskId: task.id,
        provider: 'gitlab',
        repo,
        number: a.iid,
        title: a.title.slice(0, 200),
        state,
        url: a.url,
        headRef: a.source_branch ?? null,
        baseRef: a.target_branch ?? null,
        authorLogin: payload.user?.username ?? null,
        mergedAt,
      },
      update: {
        provider: 'gitlab',
        title: a.title.slice(0, 200),
        state,
        url: a.url,
        headRef: a.source_branch ?? null,
        baseRef: a.target_branch ?? null,
        authorLogin: payload.user?.username ?? null,
        mergedAt,
      },
    });
    upserted++;
  }
  return { matched: tasks.length, upserted };
}
