import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
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

/** Verify a PKCE S256 challenge against the presented verifier (constant-time). */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false;
  const computed = b64url(createHash('sha256').update(verifier).digest());
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The public base URL of this deployment (issuer / endpoint base). */
export function baseUrl(): string {
  return (process.env.PUBLIC_BASE_URL?.trim() || 'https://pm.since-b24-ru.ru').replace(/\/+$/, '');
}

/**
 * A redirect_uri is acceptable for Dynamic Client Registration iff it is https,
 * or http ONLY for loopback (native/desktop clients). Plain http to a remote
 * host is rejected — otherwise an attacker can register a client that exfiltrates
 * an auth code over cleartext to any server they control.
 */
export function isAllowedRedirectUri(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol === 'https:') return true;
  if (u.protocol === 'http:') {
    // WHATWG URL returns the IPv6 literal WITH brackets, e.g. '[::1]'.
    const h = u.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
  }
  return false;
}

/**
 * Consent CSRF protection.
 *
 * The authorize consent screen is shown on GET; approval MUST arrive as a POST
 * carrying a signed, single-purpose token. The token is an HMAC (keyed by the
 * NextAuth secret) over the logged-in user's id PLUS every security-relevant
 * request parameter, with a short expiry. Because the signing key is server-only
 * and the token is bound to the victim's user id, an attacker cannot forge one
 * for a logged-in victim (CSRF) nor swap the client_id / redirect_uri / PKCE
 * challenge after the user consented (parameter tampering).
 */
export const CONSENT_TTL_MS = 10 * 60 * 1000; // 10 minutes to complete consent

export interface ConsentBinding {
  userId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  state: string;
}

function consentSecret(): string {
  const s = process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
  if (!s) throw new Error('AUTH_SECRET is not set — cannot sign OAuth consent tokens');
  return s;
}

function consentCanonical(b: ConsentBinding, exp: number): string {
  // Newline-joined; values are opaque ids / URLs / base64url challenges that
  // never contain a newline, so this is unambiguous.
  return [b.userId, b.clientId, b.redirectUri, b.codeChallenge, b.scope, b.state, String(exp)].join('\n');
}

/** Mint a consent token bound to (user, request params), valid for CONSENT_TTL_MS. */
export function signConsentToken(b: ConsentBinding): string {
  const exp = Date.now() + CONSENT_TTL_MS;
  const sig = createHmac('sha256', consentSecret()).update(consentCanonical(b, exp)).digest();
  return `${exp}.${b64url(sig)}`;
}

/** Verify a consent token against the live binding. Constant-time, expiry-checked. */
export function verifyConsentToken(token: string, b: ConsentBinding): boolean {
  const dot = token.indexOf('.');
  if (dot < 0) return false;
  const exp = Number(token.slice(0, dot));
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const provided = token.slice(dot + 1);
  const expected = b64url(createHmac('sha256', consentSecret()).update(consentCanonical(b, exp)).digest());
  const a = Buffer.from(provided);
  const e = Buffer.from(expected);
  return a.length === e.length && timingSafeEqual(a, e);
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
