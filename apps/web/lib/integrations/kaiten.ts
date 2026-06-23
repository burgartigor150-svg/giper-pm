import 'server-only';
import { prisma } from '@giper/db';
import { encryptToken, decryptToken, maskToken } from '@/lib/tgTokenCrypto';
import {
  KaitenClient,
  runKaitenSync,
  normalizeKaitenDomain,
  type RunKaitenSyncResult,
  type KaitenMatchScope,
} from '@giper/integrations/kaiten';

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

/** Build a KaitenClient from the stored project connection, or null if not connected. */
export async function buildKaitenClient(projectId: string, signal?: AbortSignal): Promise<KaitenClient | null> {
  const link = await getKaitenLink(projectId);
  if (!link) return null;
  const c = (link.config ?? {}) as unknown as KaitenProjectConfig;
  if (!c.tokenEnc || !c.domain) return null;
  return new KaitenClient({ domain: c.domain, apiKey: decryptToken(c.tokenEnc), signal });
}

export type KaitenSyncOutcome = { ok: boolean; summary: string; result?: RunKaitenSyncResult };

/**
 * Run a Kaiten import for one project end-to-end and persist a last-sync summary
 * back onto the connection. Shared by the manual button and the cron (K2).
 */
export async function runKaitenSyncNow(projectId: string, opts?: { signal?: AbortSignal }): Promise<KaitenSyncOutcome> {
  const link = await getKaitenLink(projectId);
  if (!link) return { ok: false, summary: 'Kaiten не подключён к проекту' };
  const c = (link.config ?? {}) as unknown as KaitenProjectConfig;
  if (!c.tokenEnc || !c.domain || !c.boardId) return { ok: false, summary: 'Kaiten не подключён к проекту' };

  const client = new KaitenClient({ domain: c.domain, apiKey: decryptToken(c.tokenEnc), signal: opts?.signal });

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

  try {
    const result = await runKaitenSync(
      prisma,
      client,
      { projectId, boardId: c.boardId, matchScope: c.matchScope ?? 'project' },
      { signal: opts?.signal },
    );
    const summary =
      `Карточек: ${result.cards} (новых: ${result.created}, обновлено: ${result.updated}), ` +
      `связано дублей: ${result.autoLinked}, кандидатов: ${result.suggestions}` +
      (result.truncated ? `, достигнут лимит импорта` : '') +
      (result.errors.length ? `, ошибок: ${result.errors.length}` : '');
    const status = result.ok ? 'SUCCESS' : 'PARTIAL';
    await writeSummary(summary, status);
    return { ok: result.ok, summary, result };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await writeSummary(`Ошибка: ${msg}`, 'FAILED');
    return { ok: false, summary: msg };
  }
}
