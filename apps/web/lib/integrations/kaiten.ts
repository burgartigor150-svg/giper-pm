import { prisma } from '@giper/db';
import { encryptToken, decryptToken, maskToken } from '@/lib/tgTokenCrypto';
import {
  KaitenClient,
  runKaitenSync,
  pushKaitenComment,
  normalizeKaitenDomain,
  type RunKaitenSyncResult,
  type KaitenMatchScope,
} from '@giper/integrations/kaiten';
import { syncKaitenFiles, type SyncKaitenFilesResult } from '@/lib/integrations/kaitenFiles';

/**
 * Per-project Kaiten connection. One project ↔ one Kaiten board. Each project
 * stores its own domain + API token (encrypted at rest) + board id in a
 * ProjectIntegration row, linked to a single org-level Integration(kind=KAITEN)
 * placeholder. Import is one-way (Kaiten → giper-pm) and matches imported cards
 * to the project's Bitrix-mirrored tasks as DUPLICATES.
 */

const SINGLETON_NAME = 'cloud';

export type KaitenProjectConfig = {
  domain: string;
  tokenEnc: string;
  tokenHint: string;
  boardId: number;
  spaceId?: number;
  matchScope?: KaitenMatchScope;
  lastSyncAt?: string;
  lastSyncStatus?: string;
  lastSyncSummary?: string;
};

export type KaitenStatus = {
  connected: boolean;
  domain?: string;
  boardId?: number;
  spaceId?: number;
  matchScope?: KaitenMatchScope;
  tokenHint?: string;
  lastSyncAt?: string;
  lastSyncStatus?: string;
  lastSyncSummary?: string;
};

/** The single org-level placeholder Integration that per-project links hang off. */
async function ensureKaitenIntegrationId(): Promise<string> {
  const row = await prisma.integration.upsert({
    where: { kind_name: { kind: 'KAITEN', name: SINGLETON_NAME } },
    update: {},
    create: { kind: 'KAITEN', name: SINGLETON_NAME, config: {}, isActive: true },
    select: { id: true },
  });
  return row.id;
}

async function getKaitenLink(projectId: string) {
  return prisma.projectIntegration.findFirst({
    where: { projectId, integration: { kind: 'KAITEN' } },
    select: { id: true, externalId: true, config: true },
  });
}

export async function getKaitenStatus(projectId: string): Promise<KaitenStatus> {
  const link = await getKaitenLink(projectId);
  if (!link) return { connected: false };
  const c = (link.config ?? {}) as unknown as KaitenProjectConfig;
  return {
    connected: !!c.tokenEnc,
    domain: c.domain,
    boardId: c.boardId,
    spaceId: c.spaceId,
    matchScope: c.matchScope ?? 'project',
    tokenHint: c.tokenHint,
    lastSyncAt: c.lastSyncAt,
    lastSyncStatus: c.lastSyncStatus,
    lastSyncSummary: c.lastSyncSummary,
  };
}

export type SaveKaitenInput = {
  projectId: string;
  domain: string;
  token: string;
  boardId: number;
  spaceId?: number;
  matchScope?: KaitenMatchScope;
};

/** Persist (or replace) the project's Kaiten connection. Returns a validation error string or null. */
export async function saveKaitenConnection(input: SaveKaitenInput): Promise<string | null> {
  const domain = normalizeKaitenDomain(input.domain);
  if (!domain) return 'Неверный домен Kaiten (ожидается <компания>.kaiten.ru)';
  const token = input.token.trim();
  if (!token) return 'Укажите API-ключ Kaiten';
  if (!Number.isInteger(input.boardId) || input.boardId <= 0) return 'Укажите корректный ID доски';

  const config: KaitenProjectConfig = {
    domain,
    tokenEnc: encryptToken(token),
    tokenHint: maskToken(token),
    boardId: input.boardId,
    spaceId: input.spaceId && input.spaceId > 0 ? input.spaceId : undefined,
    matchScope: input.matchScope === 'org' ? 'org' : 'project',
  };

  const integrationId = await ensureKaitenIntegrationId();
  // One project ↔ one Kaiten board: drop any prior Kaiten link for this project.
  await prisma.$transaction([
    prisma.projectIntegration.deleteMany({ where: { projectId: input.projectId, integration: { kind: 'KAITEN' } } }),
    prisma.projectIntegration.create({
      data: {
        projectId: input.projectId,
        integrationId,
        externalId: String(input.boardId),
        config: config as unknown as object,
      },
    }),
  ]);
  return null;
}

export async function disconnectKaiten(projectId: string): Promise<void> {
  await prisma.projectIntegration.deleteMany({
    where: { projectId, integration: { kind: 'KAITEN' } },
  });
}

/**
 * Push a locally-authored EXTERNAL comment to Kaiten, if its task is Kaiten-linked
 * and the project has a connection. Best-effort: a failure never blocks the local
 * comment (mirrors the Bitrix outbound). Fan-out is by task linkage — a Bitrix
 * task's comment goes to Bitrix (separate helper), a Kaiten task's goes here.
 */
export async function pushKaitenCommentBestEffort(commentId: string): Promise<void> {
  try {
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      select: { task: { select: { projectId: true, externalSource: true } } },
    });
    if (!comment || comment.task.externalSource !== 'kaiten') return;
    const client = await buildKaitenClient(comment.task.projectId);
    if (!client) return;
    await pushKaitenComment(prisma, client, commentId);
  } catch (e) {
    console.error('kaiten outbound: pushComment failed', commentId, e);
  }
}

/** Build a KaitenClient from the stored project connection, or null if not connected. */
export async function buildKaitenClient(projectId: string, signal?: AbortSignal): Promise<KaitenClient | null> {
  const link = await getKaitenLink(projectId);
  if (!link) return null;
  const c = (link.config ?? {}) as unknown as KaitenProjectConfig;
  if (!c.tokenEnc || !c.domain) return null;
  return new KaitenClient({ domain: c.domain, apiKey: decryptToken(c.tokenEnc), signal });
}

export type KaitenSuggestion = {
  id: string;
  score: number;
  kaiten: { id: string; title: string; key: string };
  bitrix: { id: string; title: string; key: string };
};

const taskKey = (t: { number: number; project: { key: string } }) => `${t.project.key}-${t.number}`;

/** Pending Kaiten↔Bitrix match suggestions for a project, newest/highest first. */
export async function getKaitenSuggestions(projectId: string): Promise<KaitenSuggestion[]> {
  const rows = await prisma.kaitenMatchSuggestion.findMany({
    where: { projectId, status: 'pending' },
    orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
    take: 200,
    select: {
      id: true,
      score: true,
      kaitenTask: { select: { id: true, title: true, number: true, project: { select: { key: true } } } },
      bitrixTask: { select: { id: true, title: true, number: true, project: { select: { key: true } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    score: r.score,
    kaiten: { id: r.kaitenTask.id, title: r.kaitenTask.title, key: taskKey(r.kaitenTask) },
    bitrix: { id: r.bitrixTask.id, title: r.bitrixTask.title, key: taskKey(r.bitrixTask) },
  }));
}

/** Accept a suggestion: create the DUPLICATES link and mark it accepted. Returns
 *  false if it was already decided (e.g. a concurrent accept won the race). */
export async function acceptKaitenSuggestion(id: string, userId: string): Promise<boolean> {
  const s = await prisma.kaitenMatchSuggestion.findUnique({
    where: { id },
    select: { kaitenTaskId: true, bitrixTaskId: true, status: true },
  });
  if (!s || s.status !== 'pending') return false;
  // Claim the row first (atomic guard) so a concurrent accept can't double-apply.
  const claimed = await prisma.kaitenMatchSuggestion.updateMany({
    where: { id, status: 'pending' },
    data: { status: 'accepted', decidedAt: new Date(), decidedById: userId },
  });
  if (claimed.count === 0) return false;
  await prisma.taskDependency
    .create({ data: { fromTaskId: s.kaitenTaskId, toTaskId: s.bitrixTaskId, linkType: 'DUPLICATES', createdById: userId } })
    .catch(() => {}); // unique conflict → link already exists; row is already marked accepted
  return true;
}

/** Reject a suggestion: suppress the pair so future syncs don't re-propose it.
 *  Returns false if it was already decided. */
export async function rejectKaitenSuggestion(id: string, userId: string): Promise<boolean> {
  const upd = await prisma.kaitenMatchSuggestion.updateMany({
    where: { id, status: 'pending' },
    data: { status: 'rejected', decidedAt: new Date(), decidedById: userId },
  });
  return upd.count > 0;
}

export type KaitenSyncOutcome = { ok: boolean; skipped?: boolean; summary: string; result?: RunKaitenSyncResult };

const SYNC_LOCK_MS = 15 * 60 * 1000;

/**
 * Run a Kaiten import for one project end-to-end and persist a last-sync summary
 * back onto the connection. Shared by the manual button and the cron. A per-
 * connection lock (a timestamp marker in config, set/cleared atomically) keeps a
 * cron run and a manual click from importing the same board concurrently.
 */
export async function runKaitenSyncNow(
  projectId: string,
  opts?: { signal?: AbortSignal; reconcileArchived?: boolean },
): Promise<KaitenSyncOutcome> {
  const link = await getKaitenLink(projectId);
  if (!link) return { ok: false, summary: 'Kaiten не подключён к проекту' };
  const c = (link.config ?? {}) as unknown as KaitenProjectConfig;
  if (!c.tokenEnc || !c.domain || !c.boardId) return { ok: false, summary: 'Kaiten не подключён к проекту' };

  // Build the client BEFORE acquiring the lock — its ctor (domain validation,
  // token decrypt) can throw, and we must not leak a held lock if it does.
  let client: KaitenClient;
  try {
    client = new KaitenClient({ domain: c.domain, apiKey: decryptToken(c.tokenEnc), signal: opts?.signal });
  } catch (e) {
    return { ok: false, summary: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }

  // Acquire the lock: set syncRunningAt (epoch ms) only if no fresh marker is
  // present. Atomic — a second caller's UPDATE matches no row and returns 0.
  // Epoch-ms (not a timestamp string) keeps the comparison a plain integer
  // compare, with no locale/format/timestamptz parsing in the hot path.
  // `->>` yields NULL for both an absent key and a JSON-null value, so it covers
  // "no lock" without the jsonb `?` existence operator (which can collide with a
  // driver's parameter placeholder).
  const nowMs = Date.now();
  const acquired = await prisma.$executeRaw`
    UPDATE "ProjectIntegration"
    SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{syncRunningAt}', to_jsonb(${nowMs}::bigint))
    WHERE id = ${link.id}
      AND (
        config->>'syncRunningAt' IS NULL
        OR (config->>'syncRunningAt')::bigint < ${nowMs - SYNC_LOCK_MS}
      )`;
  if (acquired === 0) return { ok: false, skipped: true, summary: 'Синхронизация уже выполняется' };

  // Write ONLY the three lastSync keys atomically via jsonb_set, so a concurrent
  // saveKaitenConnection (new token/domain/board) is never clobbered by a stale
  // in-memory config captured at the start of a long-running sync.
  const writeSummary = async (summary: string, status: string) => {
    await prisma.$executeRaw`
      UPDATE "ProjectIntegration"
      SET config = jsonb_set(
        jsonb_set(
          jsonb_set(COALESCE(config, '{}'::jsonb), '{lastSyncAt}', to_jsonb(${new Date().toISOString()}::text)),
          '{lastSyncStatus}', to_jsonb(${status}::text)
        ),
        '{lastSyncSummary}', to_jsonb(${summary}::text)
      )
      WHERE id = ${link.id}`;
  };

  const releaseLock = async () => {
    await prisma.$executeRaw`
      UPDATE "ProjectIntegration" SET config = config - 'syncRunningAt' WHERE id = ${link.id}`;
  };

  try {
    const result = await runKaitenSync(
      prisma,
      client,
      {
        projectId,
        boardId: c.boardId,
        matchScope: c.matchScope ?? 'project',
        reconcileArchived: opts?.reconcileArchived,
        syncComments: true,
        syncUsers: true,
      },
      { signal: opts?.signal },
    );
    // Mirror card files → task attachments (downloaded into our S3).
    let fileResult: SyncKaitenFilesResult = { files: 0, deleted: 0, errors: [] };
    try {
      fileResult = await syncKaitenFiles(client, projectId, { signal: opts?.signal });
    } catch (e) {
      fileResult.errors.push(e instanceof Error ? e.message : String(e));
    }

    const totalErrors = result.errors.length + fileResult.errors.length;
    const ok = result.ok && fileResult.errors.length === 0;
    const summary =
      `Карточек: ${result.cards} (новых: ${result.created}, обновлено: ${result.updated}), ` +
      `связано дублей: ${result.autoLinked}, кандидатов: ${result.suggestions}` +
      (result.comments ? `, комментариев: ${result.comments}` : '') +
      (result.usersCreated ? `, пользователей: ${result.usersCreated}` : '') +
      (result.members ? `, участников: ${result.members}` : '') +
      (fileResult.files ? `, файлов: ${fileResult.files}` : '') +
      (result.reconciled ? `, архивных обновлено: ${result.reconciled}` : '') +
      (result.truncated ? `, достигнут лимит импорта` : '') +
      (totalErrors ? `, ошибок: ${totalErrors}` : '');
    const status = ok ? 'SUCCESS' : 'PARTIAL';
    await writeSummary(summary, status);
    return { ok, summary, result };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await writeSummary(`Ошибка: ${msg}`, 'FAILED');
    return { ok: false, summary: msg };
  } finally {
    // If release fails, the 15-min stale-marker check self-heals on the next run;
    // log it so a persistent failure is observable rather than silent.
    await releaseLock().catch((e) => {
      console.error(`[kaiten] failed to release sync lock for project ${projectId}:`, e);
    });
  }
}

export type KaitenAllSyncResult = { projectId: string; ok: boolean; skipped?: boolean; summary: string };

/**
 * Run a reconciling sync for every connected project. Used by the cron — keeps
 * the mirror fresh as the remote team adds/archives cards.
 */
export async function runAllKaitenSyncs(opts?: { signal?: AbortSignal }): Promise<KaitenAllSyncResult[]> {
  const links = await prisma.projectIntegration.findMany({
    where: { integration: { kind: 'KAITEN' } },
    select: { projectId: true },
  });
  const out: KaitenAllSyncResult[] = [];
  for (const l of links) {
    if (opts?.signal?.aborted) break;
    // Isolate failures: one project's error must not abort the rest of the run.
    try {
      const r = await runKaitenSyncNow(l.projectId, { signal: opts?.signal, reconcileArchived: true });
      out.push({ projectId: l.projectId, ok: r.ok, skipped: r.skipped, summary: r.summary });
    } catch (e) {
      out.push({
        projectId: l.projectId,
        ok: false,
        summary: (e instanceof Error ? e.message : String(e)).slice(0, 300),
      });
    }
  }
  return out;
}
