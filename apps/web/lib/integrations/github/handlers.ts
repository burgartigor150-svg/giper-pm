import { prisma, type PullRequestState } from '@giper/db';
import { parseTaskRefs } from './parseRefs';

/**
 * GitHub webhook payload handlers. We only consume what we need; the
 * webhook receiver passes the full body and we cherry-pick.
 *
 * Idempotency:
 *   - Commit comments are deduped by (externalSource='github', externalId=<sha>)
 *     so re-delivery of a `push` event doesn't create duplicate rows.
 *   - PRs are deduped by (repo, number, taskId) — the unique constraint
 *     on TaskPullRequest. We use upsert.
 */

type GitHubUser = { login?: string; name?: string };
type GitHubCommit = {
  id?: string;
  message?: string;
  url?: string;
  author?: GitHubUser;
};
type PushPayload = {
  ref?: string;
  repository?: { full_name?: string; html_url?: string };
  commits?: GitHubCommit[];
  pusher?: GitHubUser;
};

/** Resolve `projectKey-number` refs to task ids the actor's webhook user
 * doesn't need to be authenticated for — the GitHub webhook is trusted
 * by the shared secret. */
async function resolveTaskIds(
  refs: { projectKey: string; number: number }[],
): Promise<{ id: string; key: string; number: number }[]> {
  if (refs.length === 0) return [];
  // Group by project key for one-shot lookup.
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

export async function handlePush(payload: PushPayload): Promise<{
  matched: number;
  comments: number;
}> {
  const repo = payload.repository?.full_name ?? '';
  const repoUrl = payload.repository?.html_url ?? '';
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
          externalSource_externalId: {
            externalSource: 'github',
            externalId,
          },
        },
        select: { id: true, taskId: true },
      });
      if (existing) {
        // Already posted once — webhook redelivery, skip.
        continue;
      }

      // Author resolution: prefer matching by GitHub login → User.email
      // fallback isn't reliable, so we fall back to the project owner
      // as the comment author. Body still credits the GH author.
      const fallback = await prisma.user.findFirst({
        where: { role: 'ADMIN', isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!fallback) continue;

      const shortSha = c.id.slice(0, 7);
      const ghAuthor = c.author?.name || c.author?.login || 'кто-то';
      const link = c.url || `${repoUrl}/commit/${c.id}`;
      const body = `🔧 ${ghAuthor} закоммитил [${shortSha}](${link}) в ${repo}\n\n> ${c.message
        .split('\n')[0]!
        .slice(0, 200)}`;

      await prisma.comment.create({
        data: {
          taskId: task.id,
          authorId: fallback.id,
          body,
          source: 'GITHUB',
          visibility: 'INTERNAL',
          externalSource: 'github',
          externalId,
        },
      });
      comments++;
    }
  }

  return { matched, comments };
}

type PullRequestPayload = {
  action?: string;
  pull_request?: {
    number?: number;
    title?: string;
    body?: string | null;
    state?: 'open' | 'closed';
    merged?: boolean;
    merged_at?: string | null;
    html_url?: string;
    head?: { ref?: string };
    base?: { ref?: string };
    user?: GitHubUser;
    draft?: boolean;
  };
  repository?: { full_name?: string };
};

function deriveState(pr: NonNullable<PullRequestPayload['pull_request']>): PullRequestState {
  if (pr.merged) return 'MERGED';
  if (pr.state === 'closed') return 'CLOSED';
  if (pr.draft) return 'DRAFT';
  return 'OPEN';
}

export async function handlePullRequest(
  payload: PullRequestPayload,
): Promise<{ matched: number; upserted: number }> {
  const pr = payload.pull_request;
  const repo = payload.repository?.full_name;
  if (!pr || !repo || pr.number == null || !pr.title || !pr.html_url) {
    return { matched: 0, upserted: 0 };
  }

  // Refs are looked up across title + body + branch name. Branch is
  // common (`feature/KSRIA-42-foo`), title and body are the explicit
  // references devs add for visibility.
  const haystack = [pr.title, pr.body ?? '', pr.head?.ref ?? ''].join(' ');
  const refs = parseTaskRefs(haystack);
  if (refs.length === 0) return { matched: 0, upserted: 0 };

  const tasks = await resolveTaskIds(refs);
  const state = deriveState(pr);
  const mergedAt = pr.merged_at ? new Date(pr.merged_at) : null;

  let upserted = 0;
  for (const task of tasks) {
    await prisma.taskPullRequest.upsert({
      where: {
        repo_number_taskId: { repo, number: pr.number, taskId: task.id },
      },
      create: {
        taskId: task.id,
        repo,
        number: pr.number,
        title: pr.title.slice(0, 200),
        state,
        url: pr.html_url,
        headRef: pr.head?.ref ?? null,
        baseRef: pr.base?.ref ?? null,
        authorLogin: pr.user?.login ?? null,
        mergedAt,
      },
      update: {
        title: pr.title.slice(0, 200),
        state,
        url: pr.html_url,
        headRef: pr.head?.ref ?? null,
        baseRef: pr.base?.ref ?? null,
        authorLogin: pr.user?.login ?? null,
        mergedAt,
      },
    });
    upserted++;
  }
  return { matched: tasks.length, upserted };
}
