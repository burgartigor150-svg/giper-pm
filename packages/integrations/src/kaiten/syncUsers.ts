import type { PrismaClient } from '@giper/db';
import { KaitenClient } from './client';

export type SyncKaitenUsersResult = {
  total: number;
  created: number;
  matched: number;
  linked: number;
  errors: string[];
};

/**
 * Pull all Kaiten users and reconcile with our User table. Match by kaitenUserId,
 * then by email (case-insensitive). Unmatched users with an email are created as
 * ACTIVE accounts with no password (login requires an admin to set one / SSO);
 * users without an email can't be created (email is the unique key). Virtual
 * (service) accounts are skipped.
 */
/** Roles we never auto-link to a Kaiten identity by email — a poisoned/compromised
 *  Kaiten /users payload must not be able to attach itself to a privileged account. */
const PRIVILEGED_ROLES = new Set(['ADMIN', 'PM']);
const MAX_USERS = 5000;

export async function syncKaitenUsers(prisma: PrismaClient, client: KaitenClient): Promise<SyncKaitenUsersResult> {
  let list: Awaited<ReturnType<KaitenClient['listUsers']>>;
  try {
    list = await client.listUsers();
  } catch (e) {
    return { total: 0, created: 0, matched: 0, linked: 0, errors: [e instanceof Error ? e.message : String(e)] };
  }
  const res: SyncKaitenUsersResult = { total: list.length, created: 0, matched: 0, linked: 0, errors: [] };
  if (list.length > MAX_USERS) {
    res.errors.push(`users ${list.length} > cap ${MAX_USERS}, truncated`);
    list = list.slice(0, MAX_USERS);
  }

  for (const u of list) {
    if (u.virtual) continue;
    const kid = String(u.id);
    try {
      // 1. Durable link first — the kaitenUserId is the source of truth.
      const byKid = await prisma.user.findUnique({ where: { kaitenUserId: kid }, select: { id: true } });
      if (byKid) {
        res.matched++;
        continue;
      }
      // 2. Email match (deterministic). Never auto-link a privileged account or one
      //    already linked to a different Kaiten id.
      if (u.email) {
        const byEmail = await prisma.user.findFirst({
          where: { email: { equals: u.email, mode: 'insensitive' } },
          select: { id: true, role: true, kaitenUserId: true },
          orderBy: { createdAt: 'asc' },
        });
        if (byEmail) {
          res.matched++;
          if (!byEmail.kaitenUserId && !PRIVILEGED_ROLES.has(byEmail.role)) {
            // Atomic conditional link — only if still unlinked, so concurrent syncs
            // can't corrupt the mapping (the loser's updateMany matches 0 rows).
            const upd = await prisma.user.updateMany({
              where: { id: byEmail.id, kaitenUserId: null },
              data: { kaitenUserId: kid },
            });
            if (upd.count > 0) res.linked++;
          }
          continue;
        }
        // 3. No local user → create an active stub (no password → no login until set).
        await prisma.user.create({
          data: {
            email: u.email,
            name: (u.full_name ?? '').trim() || u.email,
            role: 'MEMBER',
            isActive: true,
            kaitenUserId: kid,
            mustChangePassword: true,
          },
        });
        res.created++;
      }
    } catch (e) {
      res.errors.push(`user ${u.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return res;
}

/** kaitenUserId (numeric) → local User id, for attribution during a sync. */
export async function buildKaitenUserMap(prisma: PrismaClient): Promise<Map<number, string>> {
  const rows = await prisma.user.findMany({
    where: { kaitenUserId: { not: null } },
    select: { id: true, kaitenUserId: true },
  });
  const map = new Map<number, string>();
  for (const r of rows) {
    const n = Number(r.kaitenUserId);
    if (Number.isFinite(n)) map.set(n, r.id);
  }
  return map;
}
