'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { teamlyAuthorize, runTeamlySync, isValidTeamlySlug } from '@giper/integrations/teamly';
import { saveTeamlyConnection, disconnectTeamly, recordTeamlySync, buildTeamlyClient } from '@/lib/integrations/teamly';

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

const PATH = '/settings/integrations/teamly';
const DENY: ActionResult<never> = { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Только ADMIN' } };

/**
 * Connect TEAMLY by exchanging an OAuth authorization code for tokens, then
 * persisting them (encrypted). ADMIN-only — it stores an org-level secret and
 * triggers org-wide writes (matches the Bitrix integration's gate).
 */
export async function connectTeamlyAction(input: {
  slug: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<ActionResult> {
  const me = await requireAuth();
  if (me.role !== 'ADMIN') return DENY;
  const slug = input.slug.trim();
  const clientId = input.clientId.trim();
  const clientSecret = input.clientSecret.trim();
  const redirectUri = input.redirectUri.trim();
  const code = input.code.trim();
  if (!slug || !clientId || !clientSecret || !redirectUri || !code) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Заполните все поля' } };
  }
  if (!isValidTeamlySlug(slug)) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Некорректный slug (только буквы, цифры, дефис)' } };
  }
  try {
    const tokens = await teamlyAuthorize({ slug, clientId, clientSecret, redirectUri }, code);
    if (!tokens.accessToken || !tokens.refreshToken) {
      return { ok: false, error: { code: 'VALIDATION', message: 'TEAMLY не вернул токены — проверьте client_secret и code' } };
    }
    await saveTeamlyConnection({ slug, clientId, clientSecret, redirectUri }, tokens, me.id);
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: { code: 'TEAMLY_AUTH', message: `Не удалось авторизоваться: ${String(e).slice(0, 200)}` } };
  }
}

export async function disconnectTeamlyAction(): Promise<ActionResult> {
  const me = await requireAuth();
  if (me.role !== 'ADMIN') return DENY;
  await disconnectTeamly();
  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Trigger a sync now. Bounded by the Server-Action timeout — large bases should
 * rely on the periodic cron; re-running is safe (idempotent, resumes).
 */
export async function runTeamlySyncAction(): Promise<ActionResult<{ summary: string }>> {
  const me = await requireAuth();
  if (me.role !== 'ADMIN') return DENY;
  const client = await buildTeamlyClient();
  if (!client) {
    return { ok: false, error: { code: 'NOT_CONNECTED', message: 'TEAMLY не подключён' } };
  }
  try {
    const res = await runTeamlySync(prisma, client, { incremental: true });
    const summary = `Пространств: ${res.spaces}, статей: ${res.articles}, пропущено: ${res.skipped}${
      res.errors.length ? `, ошибок: ${res.errors.length}` : ''
    }`;
    await recordTeamlySync(summary, res.ok ? 'SUCCESS' : 'PARTIAL');
    revalidatePath(PATH);
    revalidatePath('/knowledge');
    return { ok: true, data: { summary } };
  } catch (e) {
    await recordTeamlySync(`Ошибка: ${String(e).slice(0, 200)}`, 'FAILED');
    return { ok: false, error: { code: 'SYNC_FAILED', message: String(e).slice(0, 200) } };
  }
}
