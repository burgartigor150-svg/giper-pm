import type { PrismaClient } from '@giper/db';
import { generateProjectKey } from '@giper/shared';
import { Bitrix24Client } from './client';
import type { BxWorkgroup } from './types';

export type SyncProjectsResult = {
  totalSeen: number;
  created: number;
  updated: number;
  skipped: number;
};

export type SyncProjectsOptions = {
  /**
   * When set, only mirror workgroups this Bitrix24 user is a member of.
   * We resolve membership through `sonet_group.user.groups` and then load
   * full data for each via `sonet_group.get` with `FILTER.ID = [...]`.
   */
  forBitrixUserId?: string | null;
  /**
   * Additional workgroup IDs to include even if the user isn't a member —
   * for example, groups containing tasks where they're an accomplice or
   * auditor (the "collab" case). Caller is expected to discover these via
   * `tasks.task.list` with MEMBER filter and pass the deduped set here.
   */
  extraGroupIds?: string[];
};

/**
 * Mirror Bitrix24 workgroups (sonet groups) → our Project table.
 *
 * Matching rule: by (externalSource='bitrix24', externalId=group.ID).
 * Owner: the first ADMIN in our system (the platform owner). We never
 * change ownership of an existing synced project on subsequent runs.
 *
 * Project key: auto-generated from name. If the generated key collides with
 * an existing manually-created project, we suffix it with the bitrix id
 * (truncated) so a forced bitrix import can never overwrite a hand-made
 * project.
 */
export async function syncProjects(
  prisma: PrismaClient,
  client: Bitrix24Client,
  opts: SyncProjectsOptions = {},
): Promise<SyncProjectsResult> {
  let groups: BxWorkgroup[];

  if (opts.forBitrixUserId) {
    // Step 1: get IDs of groups this user is a member of.
    type Membership = { GROUP_ID: string; GROUP_NAME: string; ROLE: string };
    const memberships = await client.all<Membership>('sonet_group.user.groups', {
      USER_ID: opts.forBitrixUserId,
    });
    const ids = new Set<string>(memberships.map((m) => m.GROUP_ID));
    // Step 2: union with any extra group ids the caller asked for (e.g.
    // groups discovered through accomplice/auditor task membership).
    for (const id of opts.extraGroupIds ?? []) ids.add(id);

    if (ids.size === 0) {
      return { totalSeen: 0, created: 0, updated: 0, skipped: 0 };
    }
    // Step 3: fetch full group records. Note: we DON'T filter ACTIVE/CLOSED
    // here because a user might still have open tasks in a closed group;
    // dropping such tasks silently would leak history. We surface the
    // group's archived state into Project.status instead.
    groups = await client.all<BxWorkgroup>('sonet_group.get', {
      FILTER: { ID: [...ids] },
    });
  } else {
    groups = await client.all<BxWorkgroup>('sonet_group.get', {
      FILTER: { ACTIVE: 'Y', CLOSED: 'N' },
    });
  }

  const stats: SyncProjectsResult = {
    totalSeen: groups.length,
    created: 0,
    updated: 0,
    skipped: 0,
  };

  if (groups.length === 0) return stats;

  // Find a stable owner.
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!admin) {
    // No admin to own incoming projects — sync would fail. Skip silently
    // so the rest of the suite can still run; surface in logs upstream.
    return { ...stats, skipped: groups.length };
  }

  for (const g of groups) {
    const externalId = String(g.ID);
    const existing = await prisma.project.findUnique({
      where: {
        externalSource_externalId: { externalSource: 'bitrix24', externalId },
      },
      select: { id: true, name: true, description: true, status: true },
    });

    if (existing) {
      const newName = g.NAME.slice(0, 80);
      const newDesc = g.DESCRIPTION?.slice(0, 2000) ?? null;
      const isClosed = g.CLOSED === 'Y' || g.ACTIVE === 'N';
      const newStatus = isClosed ? 'ARCHIVED' : 'ACTIVE';
      if (
        existing.name !== newName ||
        existing.description !== newDesc ||
        existing.status !== newStatus
      ) {
        await prisma.project.update({
          where: { id: existing.id },
          data: {
            name: newName,
            description: newDesc,
            status: newStatus,
            archivedAt: isClosed ? new Date() : null,
          },
        });
        stats.updated++;
      }
      continue;
    }

    const baseKey = generateProjectKey(g.NAME);
    const key = await uniqueKey(prisma, baseKey, externalId);

    await prisma.project.create({
      data: {
        key,
        name: g.NAME.slice(0, 80),
        description: g.DESCRIPTION?.slice(0, 2000) ?? null,
        ownerId: admin.id,
        externalSource: 'bitrix24',
        externalId,
        status: g.CLOSED === 'Y' ? 'ARCHIVED' : 'ACTIVE',
        members: {
          create: { userId: admin.id, role: 'LEAD' },
        },
      },
    });
    stats.created++;
  }
  return stats;
}

async function uniqueKey(
  prisma: PrismaClient,
  baseKey: string,
  externalId: string,
): Promise<string> {
  // First try the base key as-is.
  if (!(await prisma.project.findUnique({ where: { key: baseKey }, select: { id: true } }))) {
    return baseKey;
  }
  // Suffix with last 2 chars of external id; final length still ≤ 5.
  const suffix = externalId.slice(-2).toUpperCase();
  const trimmed = baseKey.slice(0, Math.max(2, 5 - suffix.length));
  const candidate = (trimmed + suffix).slice(0, 5);
  if (!(await prisma.project.findUnique({ where: { key: candidate }, select: { id: true } }))) {
    return candidate;
  }
  // Last resort — append numeric.
  for (let i = 1; i < 100; i++) {
    const c = (baseKey.slice(0, 4) + i).slice(0, 5);
    if (!(await prisma.project.findUnique({ where: { key: c }, select: { id: true } }))) {
      return c;
    }
  }
  throw new Error(`could not allocate project key for bitrix group ${externalId}`);
}
