import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@giper/db';
import type { SessionUser } from '@/lib/permissions';

/**
 * OAuth 2.1 primitives for the MCP authorization server. Tokens/codes are
 * random opaque strings; we only ever store their SHA-256 hash.
 */

export const ACCESS_TTL_SEC = 60 * 60 * 24 * 30; // 30 days
export const REFRESH_TTL_SEC = 60 * 60 * 24 * 365; // 1 year
export const CODE_TTL_SEC = 300; // 5 minutes

export function sha256(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function randomToken(prefix: string): string {
  return `${prefix}${randomBytes(32).toString('hex')}`;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Verify a PKCE S256 challenge against the presented verifier. */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false;
  const computed = b64url(createHash('sha256').update(verifier).digest());
  // constant-ish: lengths differ → false; identical compare otherwise.
  return computed.length === challenge.length && computed === challenge;
}

/** The public base URL of this deployment (issuer / endpoint base). */
export function baseUrl(): string {
  return (process.env.PUBLIC_BASE_URL?.trim() || 'https://pm.since-b24-ru.ru').replace(/\/+$/, '');
}

/** Issue an access+refresh token pair for (client, user). Returns raw tokens. */
export async function issueTokens(
  clientId: string,
  userId: string,
  scope: string | null,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const accessToken = randomToken('gpo_');
  const refreshToken = randomToken('gpr_');
  const now = Date.now();
  await prisma.oAuthAccessToken.create({
    data: {
      tokenHash: sha256(accessToken),
      clientId,
      userId,
      scope: scope ?? undefined,
      expiresAt: new Date(now + ACCESS_TTL_SEC * 1000),
    },
  });
  await prisma.oAuthRefreshToken.create({
    data: {
      tokenHash: sha256(refreshToken),
      clientId,
      userId,
      expiresAt: new Date(now + REFRESH_TTL_SEC * 1000),
    },
  });
  return { accessToken, refreshToken, expiresIn: ACCESS_TTL_SEC };
}

/**
 * Resolve a Bearer token (MCP request) to its user. Accepts BOTH the personal
 * `gpm_` API tokens and the OAuth `gpo_` access tokens. Returns null for
 * missing/expired/revoked tokens or inactive users.
 */
export async function resolveBearerUser(req: Request): Promise<SessionUser | null> {
  const auth = req.headers.get('authorization') ?? '';
  const m = auth.match(/^Bearer\s+(\S+)$/);
  if (!m || !m[1]) return null;
  const raw = m[1];

  // Personal API token path (gpm_) — same store as the public REST API.
  if (raw.startsWith('gpm_')) {
    const tok = await prisma.apiToken.findUnique({
      where: { tokenHash: sha256(raw) },
      select: { revokedAt: true, user: { select: { id: true, role: true, isActive: true } } },
    });
    if (!tok || tok.revokedAt || !tok.user.isActive) return null;
    return { id: tok.user.id, role: tok.user.role };
  }

  // OAuth access token path.
  const at = await prisma.oAuthAccessToken.findUnique({
    where: { tokenHash: sha256(raw) },
    select: { userId: true, expiresAt: true },
  });
  if (!at || at.expiresAt.getTime() < Date.now()) return null;
  const user = await prisma.user.findUnique({
    where: { id: at.userId },
    select: { id: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) return null;
  return { id: user.id, role: user.role };
}
