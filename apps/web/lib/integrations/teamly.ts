import 'server-only';
import { prisma } from '@giper/db';
import { encryptToken, decryptToken } from '@/lib/tgTokenCrypto';
import { TeamlyClient, teamlyRefresh, type TeamlyTokens } from '@giper/integrations/teamly';

/**
 * Persistence + client factory for the single TEAMLY integration. Secrets
 * (client_secret, access/refresh tokens) are encrypted at rest in the
 * Integration.config JSON via the shared AES-256-GCM helper. The built client
 * refreshes the access token on 401 and writes the new tokens back.
 */

const NAME = 'teamly';
const DEFAULT_CLUSTER = 'https://app.teamly.ru';

export type TeamlyConfig = {
  clusterDomain: string;
  slug: string;
  clientId: string;
  redirectUri: string;
  clientSecretEnc: string;
  accessTokenEnc?: string;
  refreshTokenEnc?: string;
  accessExpiresAt?: number;
  refreshExpiresAt?: number;
  lastSyncAt?: string;
  lastSyncStatus?: string;
  lastSyncSummary?: string;
};

export type TeamlyStatus = {
  connected: boolean;
  slug?: string;
  clusterDomain?: string;
  refreshExpiresAt?: number;
  lastSyncAt?: string;
  lastSyncStatus?: string;
  lastSyncSummary?: string;
};

export async function getTeamlyIntegration() {
  return prisma.integration.findUnique({ where: { kind_name: { kind: 'TEAMLY', name: NAME } } });
}

export async function getTeamlyStatus(): Promise<TeamlyStatus> {
  const row = await getTeamlyIntegration();
  if (!row) return { connected: false };
  const c = row.config as unknown as TeamlyConfig;
  return {
    connected: !!c.refreshTokenEnc && row.isActive,
    slug: c.slug,
    clusterDomain: c.clusterDomain,
    refreshExpiresAt: c.refreshExpiresAt,
    lastSyncAt: c.lastSyncAt,
    lastSyncStatus: c.lastSyncStatus,
    lastSyncSummary: c.lastSyncSummary,
  };
}

/** Persist a fresh connection (after a successful authorize). */
export async function saveTeamlyConnection(
  input: { slug: string; clientId: string; clientSecret: string; redirectUri: string; clusterDomain?: string },
  tokens: TeamlyTokens,
  createdById: string,
): Promise<void> {
  const config: TeamlyConfig = {
    clusterDomain: tokens.clusterDomain || input.clusterDomain || DEFAULT_CLUSTER,
    slug: input.slug,
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    clientSecretEnc: encryptToken(input.clientSecret),
    accessTokenEnc: encryptToken(tokens.accessToken),
    refreshTokenEnc: encryptToken(tokens.refreshToken),
    accessExpiresAt: tokens.accessExpiresAt,
    refreshExpiresAt: tokens.refreshExpiresAt,
  };
  await prisma.integration.upsert({
    where: { kind_name: { kind: 'TEAMLY', name: NAME } },
    update: { config: config as unknown as object, isActive: true },
    create: { kind: 'TEAMLY', name: NAME, config: config as unknown as object, isActive: true },
  });
  void createdById;
}

export async function disconnectTeamly(): Promise<void> {
  const row = await getTeamlyIntegration();
  if (!row) return;
  await prisma.integration.update({ where: { id: row.id }, data: { isActive: false } });
}

export async function recordTeamlySync(summary: string, status: string): Promise<void> {
  const row = await getTeamlyIntegration();
  if (!row) return;
  const c = row.config as unknown as TeamlyConfig;
  await prisma.integration.update({
    where: { id: row.id },
    data: { config: { ...c, lastSyncAt: new Date().toISOString(), lastSyncStatus: status, lastSyncSummary: summary } as unknown as object },
  });
}

/**
 * Build a TeamlyClient from the stored connection. Proactively refreshes the
 * access token if it's near expiry, and supplies a refresh callback that
 * persists rotated tokens. Returns null if not connected.
 */
export async function buildTeamlyClient(signal?: AbortSignal): Promise<TeamlyClient | null> {
  const row = await getTeamlyIntegration();
  if (!row || !row.isActive) return null;
  const c = row.config as unknown as TeamlyConfig;
  if (!c.refreshTokenEnc) return null;

  const clientSecret = decryptToken(c.clientSecretEnc);
  const refreshTokenStr = decryptToken(c.refreshTokenEnc);
  let accessToken = c.accessTokenEnc ? decryptToken(c.accessTokenEnc) : '';

  const refresh = async (): Promise<string | null> => {
    try {
      const fresh = await teamlyRefresh({ slug: c.slug, clientId: c.clientId, clientSecret }, refreshTokenStr);
      const next: TeamlyConfig = {
        ...c,
        clusterDomain: fresh.clusterDomain || c.clusterDomain,
        accessTokenEnc: encryptToken(fresh.accessToken),
        refreshTokenEnc: encryptToken(fresh.refreshToken),
        accessExpiresAt: fresh.accessExpiresAt,
        refreshExpiresAt: fresh.refreshExpiresAt,
      };
      await prisma.integration.update({ where: { id: row.id }, data: { config: next as unknown as object } });
      return fresh.accessToken;
    } catch {
      return null;
    }
  };

  // Refresh proactively if the access token is expired or expires within 60s.
  if (!accessToken || (c.accessExpiresAt && c.accessExpiresAt * 1000 < Date.now() + 60_000)) {
    const fresh = await refresh();
    if (fresh) accessToken = fresh;
  }

  return new TeamlyClient({
    clusterDomain: c.clusterDomain || DEFAULT_CLUSTER,
    slug: c.slug,
    accessToken,
    refresh,
    signal,
  });
}
