'use server';

import { prisma } from '@giper/db';
import { revalidatePath } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { canSeeSettings } from '@/lib/permissions';
import { encryptToken, maskToken } from '@/lib/tgTokenCrypto';
import { figmaMe } from '@/lib/figma/figmaApi';

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

/**
 * Connect Figma org-wide by pasting a personal access token. Validated against
 * /v1/me before storing (encrypted, like git tokens). ADMIN-only — it's an
 * org-level integration, not a per-project one.
 */
export async function connectFigmaAction(token: string): Promise<ActionResult> {
  const me = await requireAuth();
  if (!canSeeSettings(me)) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }
  const t = token.trim();
  if (!t) return { ok: false, error: { code: 'VALIDATION', message: 'Вставьте Figma-токен' } };
  try {
    await figmaMe(t);
  } catch {
    return { ok: false, error: { code: 'VALIDATION', message: 'Токен Figma недействителен' } };
  }
  await prisma.figmaConnection.upsert({
    where: { singleton: 'figma' },
    update: {
      tokenEnc: encryptToken(t),
      tokenHint: maskToken(t),
      status: 'active',
      lastError: null,
      createdById: me.id,
    },
    create: {
      singleton: 'figma',
      tokenEnc: encryptToken(t),
      tokenHint: maskToken(t),
      createdById: me.id,
    },
  });
  revalidatePath('/settings/integrations/git');
  return { ok: true };
}

/** Disconnect Figma (removes the stored token). ADMIN-only. */
export async function disconnectFigmaAction(): Promise<ActionResult> {
  const me = await requireAuth();
  if (!canSeeSettings(me)) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }
  await prisma.figmaConnection.deleteMany({ where: { singleton: 'figma' } });
  revalidatePath('/settings/integrations/git');
  return { ok: true };
}
