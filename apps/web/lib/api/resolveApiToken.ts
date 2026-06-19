import crypto from 'node:crypto';
import { prisma } from '@giper/db';
import type { SessionUser } from '@/lib/permissions';

/** SHA-256 hex of a raw API token. We only ever store / compare the hash. */
export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** Generate a fresh raw token (gpm_<48 hex>). Shown to the user once. */
export function generateRawToken(): string {
  return `gpm_${crypto.randomBytes(24).toString('hex')}`;
}

/**
 * Resolve a public-API request's `Authorization: Bearer gpm_…` token to the
 * owning user (as a SessionUser). Returns null for a missing/malformed/
 * unknown/revoked token or an inactive user. Updates lastUsedAt best-effort.
 *
 * Requests then run with the token owner's OWN visibility/permissions — the
 * public API exposes nothing the user couldn't already see in the app.
 */
export async function resolveApiToken(req: Request): Promise<SessionUser | null> {
  const auth = req.headers.get('authorization') ?? '';
  const m = auth.match(/^Bearer\s+(gpm_[A-Za-z0-9]+)$/);
  if (!m || !m[1]) return null;

  const tok = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(m[1]) },
    select: {
      id: true,
      revokedAt: true,
      user: { select: { id: true, role: true, isActive: true } },
    },
  });
  if (!tok || tok.revokedAt || !tok.user.isActive) return null;

  prisma.apiToken
    .update({ where: { id: tok.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { id: tok.user.id, role: tok.user.role };
}
