import type { PrismaClient } from '@giper/db';
import { Bitrix24Client } from './client';
import type { BxUser } from './types';

export type SyncUsersResult = {
  totalSeen: number;
  matched: number;
  updated: number;
  created: number;
};

export type SyncUsersOptions = {
  /**
   * When true, create a stub User row for every Bitrix user we don't already
   * have (role=MEMBER, isActive=false, no password). This keeps comment and
   * task author attribution intact during a Bitrix mirror without granting
   * those users login access — flipping `isActive=true` and setting a
   * password is an explicit admin operation later.
   */
  createMissing?: boolean;
  /**
   * Bitrix24 department ids whose members should be auto-activated
   * (isActive=true) on every sync run. Stub accounts created with
   * createMissing land active straight away if their UF_DEPARTMENT
   * intersects this list. Existing inactive accounts are flipped to
   * active too. Note: we never auto-deactivate someone here — that's
   * deliberate, deactivation should always be an admin decision.
   */
  activeDepartmentIds?: string[];
};

/**
 * Pulls every active user from Bitrix24 and matches them to our User table by
 * email (case-insensitive). When matched, we store `bitrixUserId` so future
 * task syncs can resolve assignees by reference.
 *
 * Default policy: read-only mirror — we don't auto-create. Pass
 * `createMissing: true` to also seed inactive stub accounts (used for
 * full-org mirrors where comment authorship matters more than account
 * hygiene).
 */
export async function syncUsers(
  prisma: PrismaClient,
  client: Bitrix24Client,
  options: SyncUsersOptions = {},
): Promise<SyncUsersResult> {
  const all: BxUser[] = await client.all<BxUser>('user.get', { ACTIVE: true });
  const stats: SyncUsersResult = {
    totalSeen: all.length,
    matched: 0,
    updated: 0,
    created: 0,
  };

  const activeDeptSet = new Set(options.activeDepartmentIds ?? []);
  function shouldAutoActivate(u: BxUser): boolean {
    if (activeDeptSet.size === 0) return false;
    const depts = (u.UF_DEPARTMENT ?? []).map((x) => String(x));
    return depts.some((d) => activeDeptSet.has(d));
  }

  for (const u of all) {
    if (!u.EMAIL) continue;
    const email = u.EMAIL.trim().toLowerCase();
    const existing = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        image: true,
        timezone: true,
        bitrixUserId: true,
        isActive: true,
      },
    });

    const fullName = [u.NAME, u.LAST_NAME].filter(Boolean).join(' ').trim();
    const autoActive = shouldAutoActivate(u);

    if (!existing) {
      if (!options.createMissing) continue;
      await prisma.user.create({
        data: {
          email,
          name: (fullName || email.split('@')[0] || email).slice(0, 80),
          role: 'MEMBER',
          // Active immediately if their dept is in the allowlist; else
          // inactive stub (resolves as comment author but can't log in).
          isActive: autoActive,
          bitrixUserId: u.ID,
          image: u.PERSONAL_PHOTO ?? null,
          avatarUrl: u.PERSONAL_PHOTO ?? null,
          timezone: u.TIME_ZONE || 'Europe/Moscow',
        },
      });
      stats.created++;
      continue;
    }

    stats.matched++;

    const looksAutoNamed =
      !existing.name ||
      existing.name === email ||
      existing.name === email.split('@')[0];

    const updates: Record<string, unknown> = {};
    if (existing.bitrixUserId !== u.ID) updates.bitrixUserId = u.ID;
    if (looksAutoNamed && fullName) updates.name = fullName.slice(0, 80);
    if (!existing.image && u.PERSONAL_PHOTO) {
      updates.image = u.PERSONAL_PHOTO;
      updates.avatarUrl = u.PERSONAL_PHOTO;
    }
    if (
      (existing.timezone === 'Europe/Moscow' || !existing.timezone) &&
      u.TIME_ZONE
    ) {
      updates.timezone = u.TIME_ZONE;
    }
    // Allowlist promote: flip inactive→active when the dept matches.
    // Never the reverse — admins might have explicitly deactivated
    // someone, and we don't want a sync to undo that.
    if (autoActive && !existing.isActive) {
      updates.isActive = true;
    }

    if (Object.keys(updates).length > 0) {
      await prisma.user.update({
        where: { id: existing.id },
        data: updates,
      });
      stats.updated++;
    }
  }
  return stats;
}
