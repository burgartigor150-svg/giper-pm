'use server';

import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';

export type PresenceUser = {
  id: string;
  name: string;
  image: string | null;
};

/**
 * Look up the display data for a list of user ids that the realtime
 * presence event identified by id. Used by the PresenceBar to render
 * avatars without forcing the WS server to know about User rows.
 *
 * Auth-gated so anonymous calls can't enumerate users by id. We trim
 * the list to a reasonable cap to keep response size bounded.
 */
export async function lookupPresenceUsers(ids: string[]): Promise<PresenceUser[]> {
  await requireAuth();
  const trimmed = ids.slice(0, 50);
  if (trimmed.length === 0) return [];
  return prisma.user.findMany({
    where: { id: { in: trimmed }, isActive: true },
    select: { id: true, name: true, image: true },
  });
}
