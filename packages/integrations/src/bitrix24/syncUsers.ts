import type { PrismaClient } from '@giper/db';
import { Bitrix24Client } from './client';
import type { BxUser } from './types';

export type SyncUsersResult = {
  totalSeen: number;
  matched: number;
  updated: number;
};

/**
 * Pulls every active user from Bitrix24 and matches them to our User table by
 * email (case-insensitive). When matched, we store `bitrixUserId` so future
 * task syncs can resolve assignees by reference.
 *
 * Read-only mirror policy: we do NOT auto-create local users. Access lives
 * on our side; sync only enriches existing accounts.
 */
export async function syncUsers(
  prisma: PrismaClient,
  client: Bitrix24Client,
): Promise<SyncUsersResult> {
  const all: BxUser[] = await client.all<BxUser>('user.get', { ACTIVE: true });
  const stats: SyncUsersResult = { totalSeen: all.length, matched: 0, updated: 0 };

  for (const u of all) {
    if (!u.EMAIL) continue;
    const email = u.EMAIL.trim().toLowerCase();
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true, bitrixUserId: true },
    });
    if (!existing) continue;
    stats.matched++;
    if (existing.bitrixUserId !== u.ID) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { bitrixUserId: u.ID },
      });
      stats.updated++;
    }
  }
  return stats;
}
