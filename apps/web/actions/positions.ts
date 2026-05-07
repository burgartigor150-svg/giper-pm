'use server';

import { revalidatePath } from 'next/cache';
import { prisma, type Position } from '@giper/db';
import { requireAuth } from '@/lib/auth';

const ALL_POSITIONS: Position[] = [
  'FRONTEND', 'BACKEND', 'FULLSTACK', 'MOBILE',
  'QA', 'QA_AUTO',
  'DESIGNER', 'UX',
  'ANALYST', 'BA',
  'PM', 'LEAD',
  'DEVOPS', 'SRE',
  'CONTENT', 'MARKETING',
  'OTHER',
];

type ActionResult = { ok: true } | { ok: false; error: { code: string; message: string } };

function isPosition(s: string): s is Position {
  return (ALL_POSITIONS as string[]).includes(s);
}

/**
 * Replace a user's full position list. Caller passes the new desired
 * set (and optionally a primary). We diff against the current rows
 * to add/remove minimally — keeps `createdAt` stable for unchanged
 * specialties and avoids an audit-log spam.
 *
 * Permission: ADMIN-only. We treat positions as HR data; PMs can
 * suggest a change, but admin signs off.
 */
export async function setUserPositionsAction(
  userId: string,
  positions: string[],
  primary: string | null,
): Promise<ActionResult> {
  const me = await requireAuth();
  if (me.role !== 'ADMIN') {
    return {
      ok: false,
      error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Только ADMIN' },
    };
  }
  const normalized = positions.filter(isPosition);
  const primaryPos = primary && isPosition(primary) ? primary : null;
  if (primaryPos && !normalized.includes(primaryPos)) {
    return {
      ok: false,
      error: { code: 'VALIDATION', message: 'Primary должна быть среди выбранных' },
    };
  }

  const existing = await prisma.userPosition.findMany({
    where: { userId },
    select: { id: true, position: true, primary: true },
  });
  const existingByPos = new Map(existing.map((e) => [e.position, e]));

  await prisma.$transaction(async (tx) => {
    // Remove positions no longer in the set.
    const toRemove = existing.filter((e) => !normalized.includes(e.position));
    if (toRemove.length > 0) {
      await tx.userPosition.deleteMany({
        where: { id: { in: toRemove.map((r) => r.id) } },
      });
    }
    // Add new ones.
    for (const pos of normalized) {
      if (!existingByPos.has(pos)) {
        await tx.userPosition.create({
          data: { userId, position: pos, primary: pos === primaryPos },
        });
      }
    }
    // Reset primary flag — exactly one row gets it (or none).
    await tx.userPosition.updateMany({
      where: { userId, primary: true },
      data: { primary: false },
    });
    if (primaryPos) {
      await tx.userPosition.updateMany({
        where: { userId, position: primaryPos },
        data: { primary: true },
      });
    }
  });

  revalidatePath('/team');
  revalidatePath(`/team/${userId}`);
  revalidatePath('/settings/users');
  return { ok: true };
}
