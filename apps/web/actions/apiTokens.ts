'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { generateRawToken, hashToken } from '@/lib/api/resolveApiToken';

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

/** Create a personal API token. Returns the raw token ONCE (never stored). */
export async function createApiTokenAction(name: string): Promise<ActionResult<{ token: string }>> {
  const me = await requireAuth();
  const clean = name.trim();
  if (clean.length < 2) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Название ≥ 2 символов' } };
  }
  const raw = generateRawToken();
  await prisma.apiToken.create({
    data: {
      userId: me.id,
      name: clean.slice(0, 80),
      tokenHash: hashToken(raw),
      prefix: `${raw.slice(0, 12)}…`,
    },
  });
  revalidatePath('/me/api-tokens');
  return { ok: true, data: { token: raw } };
}

/** Revoke one of the caller's own tokens. */
export async function revokeApiTokenAction(tokenId: string): Promise<ActionResult> {
  const me = await requireAuth();
  const tok = await prisma.apiToken.findUnique({
    where: { id: tokenId },
    select: { userId: true },
  });
  if (!tok || tok.userId !== me.id) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Токен не найден' } };
  }
  await prisma.apiToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() } });
  revalidatePath('/me/api-tokens');
  return { ok: true };
}
