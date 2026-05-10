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
  // Pull ALL Bitrix users (including ACTIVE=false). We need former
  // employees / extranet accounts as User rows so that historical
  // task creator/assignee fields resolve to a real name in the UI —
  // not a fallback admin. Their isActive in our DB stays false; only
  // the dept-allowlist promotion (below) can ever flip it to true.
  const all: BxUser[] = await client.all<BxUser>('user.get', {});
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
    if (!u.ID) continue;

    const fullName = [u.NAME, u.LAST_NAME].filter(Boolean).join(' ').trim();
    const autoActive = shouldAutoActivate(u);
    const realEmail = u.EMAIL?.trim().toLowerCase() || '';

    // Step 1: try to find an existing local row by bitrixUserId. This
    // is the durable link — once set on a previous run, email changes
    // upstream don't break the match.
    let existing = await prisma.user.findFirst({
      where: { bitrixUserId: u.ID },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        timezone: true,
        bitrixUserId: true,
        isActive: true,
      },
    });

    // Step 2: fallback — first-time linkage by email. Only if the
    // upstream user actually has one.
    if (!existing && realEmail) {
      const byEmail = await prisma.user.findUnique({
        where: { email: realEmail },
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          timezone: true,
          bitrixUserId: true,
          isActive: true,
        },
      });
      if (byEmail) existing = byEmail;
    }

    if (!existing) {
      if (!options.createMissing) continue;
      // Synthesize a unique placeholder email for users without one
      // (system bots, deactivated accounts, external contractors).
      // Stable per Bitrix id so re-runs are idempotent. The
      // @bitrix.local TLD makes it obvious in the admin UI that this
      // is a stub — and won't ever clash with a real corporate email.
      const email = realEmail || `bitrix-${u.ID}@bitrix.local`;
      const nameSeed =
        fullName ||
        (realEmail ? realEmail.split('@')[0] || realEmail : `Bitrix #${u.ID}`);
      await prisma.user.create({
        data: {
          email,
          name: nameSeed.slice(0, 80),
          role: 'MEMBER',
          // Active immediately if their dept is in the allowlist; else
          // inactive stub (resolves as comment author but can't log in).
          // Synthetic-email stubs always start inactive — they're
          // present only so creator/assignee can be displayed.
          isActive: autoActive && !!realEmail,
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

    // "Looks auto-named" — the local name is empty, equals the email,
    // or equals the local-part of the email. We use existing.email here
    // (not realEmail) because for users matched by bitrixUserId the
    // upstream email may have changed and we want to detect old auto-
    // names against whatever email they were originally created with.
    const localEmail = existing.email ?? '';
    const localPart = localEmail.includes('@') ? localEmail.split('@')[0]! : localEmail;
    const looksAutoNamed =
      !existing.name ||
      existing.name === localEmail ||
      existing.name === localPart ||
      existing.name.startsWith('Bitrix #');

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
