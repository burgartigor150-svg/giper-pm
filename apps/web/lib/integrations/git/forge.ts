/**
 * Minimal GitHub/GitLab REST client for the in-app repo-connection flow:
 * validate the token+repo, auto-create/delete the webhook, and list open
 * PRs/MRs for the initial backfill. Server-only (uses access tokens).
 *
 * The webhook we create uses our own GITHUB/GITLAB_WEBHOOK_SECRET so the
 * existing webhook routes verify it unchanged.
 */

export type Provider = 'github' | 'gitlab';

export class ForgeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ForgeError';
  }
}

function githubApiBase(baseUrl: string | null): string {
  // GitHub Enterprise serves the API under /api/v3.
  return baseUrl ? `${baseUrl.replace(/\/+$/, '')}/api/v3` : 'https://api.github.com';
}
function gitlabApiBase(baseUrl: string | null): string {
  return `${(baseUrl ?? 'https://gitlab.com').replace(/\/+$/, '')}/api/v4`;
}

async function ghFetch(
  baseUrl: string | null,
  token: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${githubApiBase(baseUrl)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}
async function glFetch(
  baseUrl: string | null,
  token: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${gitlabApiBase(baseUrl)}${path}`, {
    ...init,
    headers: {
      'PRIVATE-TOKEN': token,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

/** Validate the token can read the repo. Throws ForgeError on failure. */
export async function verifyRepo(
  provider: Provider,
  baseUrl: string | null,
  repo: string,
  token: string,
): Promise<{ canonicalRepo: string; projectId: string }> {
  if (provider === 'github') {
    const r = await ghFetch(baseUrl, token, `/repos/${repo}`);
    if (!r.ok) {
      throw new ForgeError(
        r.status === 404 ? 'Репозиторий не найден или нет доступа' : `GitHub: ${r.status}`,
        r.status,
      );
    }
    const data = (await r.json()) as { full_name?: string };
    return { canonicalRepo: data.full_name ?? repo, projectId: repo };
  }
  const r = await glFetch(baseUrl, token, `/projects/${encodeURIComponent(repo)}`);
  if (!r.ok) {
    throw new ForgeError(
      r.status === 404 ? 'Проект не найден или нет доступа' : `GitLab: ${r.status}`,
      r.status,
    );
  }
  const data = (await r.json()) as { id?: number; path_with_namespace?: string };
  return {
    canonicalRepo: data.path_with_namespace ?? repo,
    projectId: String(data.id ?? repo),
  };
}

/** Create the push+PR/MR webhook on the forge. Returns the hook id. */
export async function createWebhook(
  provider: Provider,
  baseUrl: string | null,
  projectId: string,
  token: string,
  opts: { url: string; secret: string },
): Promise<string> {
  if (provider === 'github') {
    const r = await ghFetch(baseUrl, token, `/repos/${projectId}/hooks`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'web',
        active: true,
        events: ['push', 'pull_request'],
        config: { url: opts.url, content_type: 'json', secret: opts.secret },
      }),
    });
    if (!r.ok) {
      throw new ForgeError(`GitHub webhook не создан: ${r.status}`, r.status);
    }
    const data = (await r.json()) as { id?: number };
    return String(data.id ?? '');
  }
  const r = await glFetch(baseUrl, token, `/projects/${projectId}/hooks`, {
    method: 'POST',
    body: JSON.stringify({
      url: opts.url,
      token: opts.secret,
      push_events: true,
      merge_requests_events: true,
      enable_ssl_verification: true,
    }),
  });
  if (!r.ok) {
    throw new ForgeError(`GitLab webhook не создан: ${r.status}`, r.status);
  }
  const data = (await r.json()) as { id?: number };
  return String(data.id ?? '');
}

/** Best-effort webhook removal on disconnect. Never throws. */
export async function deleteWebhook(
  provider: Provider,
  baseUrl: string | null,
  projectId: string,
  token: string,
  hookId: string,
): Promise<void> {
  try {
    if (provider === 'github') {
      await ghFetch(baseUrl, token, `/repos/${projectId}/hooks/${hookId}`, {
        method: 'DELETE',
      });
    } else {
      await glFetch(baseUrl, token, `/projects/${projectId}/hooks/${hookId}`, {
        method: 'DELETE',
      });
    }
  } catch {
    /* best-effort */
  }
}

/** List open PRs (GitHub) shaped like the pull_request webhook payload items. */
export async function listOpenGithubPrs(
  baseUrl: string | null,
  repo: string,
  token: string,
): Promise<unknown[]> {
  const r = await ghFetch(baseUrl, token, `/repos/${repo}/pulls?state=open&per_page=50`);
  if (!r.ok) return [];
  return (await r.json()) as unknown[];
}

/** List open MRs (GitLab) — raw API items. */
export async function listOpenGitlabMrs(
  baseUrl: string | null,
  projectId: string,
  token: string,
): Promise<unknown[]> {
  const r = await glFetch(
    baseUrl,
    token,
    `/projects/${projectId}/merge_requests?state=opened&per_page=50`,
  );
  if (!r.ok) return [];
  return (await r.json()) as unknown[];
}
