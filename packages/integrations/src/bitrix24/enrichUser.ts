import type { PrismaClient } from '@giper/db';
import { Bitrix24Client } from './client';
import type { BxUser } from './types';

export type EnrichResult =
  | { ok: true; matched: true; bitrixUserId: string; updated: string[] }
  | { ok: true; matched: false; reason: 'not_found_in_bitrix' }
  | { ok: false; error: string };

/**
 * One-shot user enrichment. Looks up a user in Bitrix24 by email and
 * fills in the local row's bitrixUserId / name / image / timezone. Used
 * at user-create time and from a manual "Подтянуть из Bitrix" button.
 *
 * Behaviour:
 *   - If no Bitrix user with that email exists → no-op, no error.
 *   - If found but local row already has a bitrixUserId pointing
 *     somewhere else → we trust Bitrix and overwrite. The integration
 *     is the source of truth for that link.
 *   - String-typed fields are only overwritten when the local value is
 *     null/empty — we never clobber an existing photo/timezone the
 *     user might have set themselves.
 *
 * Returns a structured result so callers can show a useful UI message.
 */
export async function enrichUserFromBitrix(
  prisma: PrismaClient,
  client: Bitrix24Client,
  userId: string,
): Promise<EnrichResult> {
  const local = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      timezone: true,
      bitrixUserId: true,
    },
  });
  if (!local) return { ok: false, error: 'user not found' };

  let bitrixUsers: BxUser[];
  try {
    // user.get accepts `FILTER` with EMAIL. Bitrix matches case-
    // insensitively but returns at most one row per exact match — we
    // grab the first one in case of casing differences across the
    // portal directory.
    bitrixUsers = await client.all<BxUser>('user.get', {
      FILTER: { EMAIL: local.email },
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // Bitrix sometimes returns inactive accounts — filter them out so a
  // departed colleague's old account doesn't shadow a newer one.
  const candidate = bitrixUsers.find(
    (u) => u.EMAIL?.toLowerCase() === local.email.toLowerCase() && u.ACTIVE,
  );
  if (!candidate) {
    return { ok: true, matched: false, reason: 'not_found_in_bitrix' };
  }

  const fullName = [candidate.NAME, candidate.LAST_NAME]
    .filter(Boolean)
    .join(' ')
    .trim();
  const updates: Record<string, unknown> = {};
  const updated: string[] = [];

  if (local.bitrixUserId !== candidate.ID) {
    updates.bitrixUserId = candidate.ID;
    updated.push('bitrixUserId');
  }
  // Only fill name if the local one is suspicious (matches the email
  // local-part — what auto-create does when no name is given).
  const looksAutoNamed =
    !local.name ||
    local.name === local.email ||
    local.name === local.email.split('@')[0];
  if (looksAutoNamed && fullName) {
    updates.name = fullName.slice(0, 80);
    updated.push('name');
  }
  if (!local.image && candidate.PERSONAL_PHOTO) {
    updates.image = candidate.PERSONAL_PHOTO;
    updates.avatarUrl = candidate.PERSONAL_PHOTO;
    updated.push('image');
  }
  if (
    (local.timezone === 'Europe/Moscow' || !local.timezone) &&
    candidate.TIME_ZONE
  ) {
    updates.timezone = candidate.TIME_ZONE;
    updated.push('timezone');
  }

  if (Object.keys(updates).length > 0) {
    await prisma.user.update({ where: { id: local.id }, data: updates });
  }
  return {
    ok: true,
    matched: true,
    bitrixUserId: candidate.ID,
    updated,
  };
}
