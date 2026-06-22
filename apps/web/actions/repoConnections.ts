'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { prisma, type MemberRole } from '@giper/db';
import { encryptToken, decryptToken, maskToken } from '@/lib/tgTokenCrypto';
import { requireAuth } from '@/lib/auth';
import { canEditProject } from '@/lib/permissions';
import { getEffectiveCaps } from '@/lib/capabilities';
import { parseRepoUrl } from '@/lib/integrations/git/parseRepoUrl';
import {
  verifyRepo,
  createWebhook,
  deleteWebhook,
  listOpenGithubPrs,
  listOpenGitlabMrs,
  ForgeError,
  type Provider,
} from '@/lib/integrations/git/forge';
import { handlePullRequest } from '@/lib/integrations/github/handlers';
import { handleMergeRequest } from '@/lib/integrations/gitlab/handlers';

type Result =
  | { ok: true; backfilled: number }
  | { ok: false; error: string };

function baseUrlForWebhook(): string {
  return process.env.PUBLIC_BASE_URL?.trim() || 'https://pm.since-b24-ru.ru';
}

function webhookSecretFor(provider: Provider): string | null {
  const v =
    provider === 'github'
      ? process.env.GITHUB_WEBHOOK_SECRET
      : process.env.GITLAB_WEBHOOK_SECRET;
  return v?.trim() || null;
}

type GateOk = {
  ok: true;
  me: Awaited<ReturnType<typeof requireAuth>>;
  project: {
    id: string;
    key: string;
    ownerId: string;
    members: { userId: string; role: MemberRole }[];
  };
};
type GateFail = { ok: false; error: string };

/** Load the project (id + perm shape) and check the caller may configure it. */
async function gateProject(projectKey: string): Promise<GateOk | GateFail> {
  const me = await requireAuth();
  const project = await prisma.project.findUnique({
    where: { key: projectKey },
    select: {
      id: true,
      key: true,
      ownerId: true,
      members: { select: { userId: true, role: true } },
    },
  });
  if (!project) return { ok: false, error: 'Проект не найден' };
  const caps = await getEffectiveCaps(me);
  if (!canEditProject(me, { ownerId: project.ownerId, members: project.members }, caps)) {
    return { ok: false, error: 'Недостаточно прав' };
  }
  return { ok: true, me, project };
}

/**
 * Connect a GitHub/GitLab repo to a project: validate the token, auto-create
 * the webhook on the forge (secret = our webhook secret), persist the
 * connection (token encrypted), then backfill open PRs/MRs.
 */
export async function connectRepoAction(input: {
  projectKey: string;
  provider: Provider;
  repoUrl: string;
  token: string;
}): Promise<Result> {
  const gated = await gateProject(input.projectKey);
  if (!gated.ok) return { ok: false, error: gated.error };
  const { me, project } = gated;

  const provider = input.provider;
  if (provider !== 'github' && provider !== 'gitlab') {
    return { ok: false, error: 'Неизвестный провайдер' };
  }
  const token = input.token.trim();
  if (!token) return { ok: false, error: 'Укажите токен доступа' };

  const parsed = parseRepoUrl(provider, input.repoUrl);
  if (!parsed) return { ok: false, error: 'Не удалось разобрать URL репозитория' };

  const secret = webhookSecretFor(provider);
  if (!secret) {
    return {
      ok: false,
      error: `Не задан ${provider === 'github' ? 'GITHUB' : 'GITLAB'}_WEBHOOK_SECRET на сервере`,
    };
  }

  // 1. Validate token + repo access.
  let verified;
  try {
    verified = await verifyRepo(provider, parsed.baseUrl, parsed.repo, token);
  } catch (e) {
    return { ok: false, error: e instanceof ForgeError ? e.message : 'Проверка доступа не удалась' };
  }
  const repo = verified.canonicalRepo;

  const existing = await prisma.repoConnection.findUnique({
    where: { provider_repo_projectId: { provider, repo, projectId: project.id } },
    select: { id: true },
  });
  if (existing) return { ok: false, error: 'Этот репозиторий уже подключён к проекту' };

  // 2. Create the webhook on the forge.
  const webhookUrl = `${baseUrlForWebhook()}/api/webhooks/${provider}`;
  let webhookId: string;
  try {
    webhookId = await createWebhook(provider, parsed.baseUrl, verified.projectId, token, {
      url: webhookUrl,
      secret,
    });
  } catch (e) {
    return { ok: false, error: e instanceof ForgeError ? e.message : 'Webhook не создан' };
  }

  // 3. Persist.
  await prisma.repoConnection.create({
    data: {
      projectId: project.id,
      provider,
      repo,
      baseUrl: parsed.baseUrl,
      tokenEnc: encryptToken(token),
      tokenHint: maskToken(token),
      webhookId,
      status: 'active',
      createdById: me.id,
    },
  });

  // 4. Best-effort backfill of currently-open PRs/MRs (linked by KEY-N).
  let backfilled = 0;
  try {
    if (provider === 'github') {
      const prs = await listOpenGithubPrs(parsed.baseUrl, repo, token);
      for (const pr of prs) {
        const res = await handlePullRequest({
          pull_request: pr as never,
          repository: { full_name: repo },
        });
        backfilled += res.upserted;
      }
    } else {
      const mrs = await listOpenGitlabMrs(parsed.baseUrl, verified.projectId, token);
      for (const mr of mrs) {
        const res = await handleMergeRequest({
          object_kind: 'merge_request',
          object_attributes: mr as never,
          project: { path_with_namespace: repo },
          user: { username: (mr as { author?: { username?: string } }).author?.username },
        });
        backfilled += res.upserted;
      }
    }
  } catch {
    /* backfill is best-effort; the webhook covers everything going forward */
  }

  revalidatePath(`/projects/${project.key}/settings`);
  return { ok: true, backfilled };
}

/** Disconnect: remove the forge webhook (best-effort) and delete the row. */
export async function disconnectRepoAction(input: {
  projectKey: string;
  connectionId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const gated = await gateProject(input.projectKey);
  if (!gated.ok) return { ok: false, error: gated.error };
  const { project } = gated;

  const conn = await prisma.repoConnection.findUnique({
    where: { id: input.connectionId },
    select: {
      id: true,
      projectId: true,
      provider: true,
      repo: true,
      baseUrl: true,
      tokenEnc: true,
      webhookId: true,
    },
  });
  if (!conn || conn.projectId !== project.id) {
    return { ok: false, error: 'Подключение не найдено' };
  }

  if (conn.webhookId) {
    try {
      const token = decryptToken(conn.tokenEnc);
      // GitLab needs the numeric project id; we stored the path. Re-resolve.
      const { projectId } = await verifyRepo(
        conn.provider as Provider,
        conn.baseUrl,
        conn.repo,
        token,
      );
      await deleteWebhook(conn.provider as Provider, conn.baseUrl, projectId, token, conn.webhookId);
    } catch {
      /* best-effort — we still drop the row */
    }
  }

  await prisma.repoConnection.delete({ where: { id: conn.id } });
  revalidatePath(`/projects/${project.key}/settings`);
  return { ok: true };
}
