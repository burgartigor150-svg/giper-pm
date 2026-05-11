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

  // Fallback owner — used only when the workgroup has no OWNER_ID or
  // its owner isn't in our system yet.
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!admin) {
    return { ...stats, skipped: groups.length };
  }

  // Resolve every distinct workgroup OWNER_ID → our User.id in one
  // round-trip so per-row creation doesn't N+1 the user table.
  const ownerBitrixIds = Array.from(
    new Set(groups.map((g) => g.OWNER_ID).filter((x): x is string => !!x)),
  );
  const ownerUsers = ownerBitrixIds.length
    ? await prisma.user.findMany({
        where: { bitrixUserId: { in: ownerBitrixIds } },
        select: { id: true, bitrixUserId: true },
      })
    : [];
  const ownerByBitrixId = new Map(
    ownerUsers
      .filter((u): u is typeof u & { bitrixUserId: string } => !!u.bitrixUserId)
      .map((u) => [u.bitrixUserId, u.id]),
  );
  function resolveOwner(g: BxWorkgroup): string {
    if (g.OWNER_ID) {
      const id = ownerByBitrixId.get(g.OWNER_ID);
      if (id) return id;
    }
    return admin!.id;
  }

  for (const g of groups) {
    const externalId = String(g.ID);
    const desiredOwnerId = resolveOwner(g);
    const existing = await prisma.project.findUnique({
      where: {
        externalSource_externalId: { externalSource: 'bitrix24', externalId },
      },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        ownerId: true,
      },
    });

    if (existing) {
      const newName = g.NAME.slice(0, 80);
      const newDesc = g.DESCRIPTION?.slice(0, 2000) ?? null;
      const isClosed = g.CLOSED === 'Y' || g.ACTIVE === 'N';
      const newStatus = isClosed ? 'ARCHIVED' : 'ACTIVE';
      // Repair ownerId if it's currently the fallback admin and we now
      // have a real owner mapping (typical after the user backfills
      // bitrixUserId on more accounts).
      const ownerNeedsFix =
        existing.ownerId === admin.id && desiredOwnerId !== admin.id;
      if (
        existing.name !== newName ||
        existing.description !== newDesc ||
        existing.status !== newStatus ||
        ownerNeedsFix
      ) {
        await prisma.project.update({
          where: { id: existing.id },
          data: {
            name: newName,
            description: newDesc,
            status: newStatus,
            archivedAt: isClosed ? new Date() : null,
            ...(ownerNeedsFix ? { ownerId: desiredOwnerId } : {}),
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
        ownerId: desiredOwnerId,
        externalSource: 'bitrix24',
        externalId,
        status: g.CLOSED === 'Y' ? 'ARCHIVED' : 'ACTIVE',
        members: {
          // Mirror the upstream owner as LEAD so they show up in the
          // members list straight away.
          create: { userId: desiredOwnerId, role: 'LEAD' },
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

export type SyncProjectMembersResult = {
  /** Projects we touched (Bitrix-mirrored only). */
  projectsScanned: number;
  /** Distinct (project, bitrixUserId) pairs after sync. */
  membershipsTotal: number;
  /** New rows inserted on this run. */
  membershipsAdded: number;
  /** Rows removed because the user left the workgroup. */
  membershipsRemoved: number;
};

/**
 * Mirror Bitrix sonet_group membership into ProjectBitrixMember.
 *
 * Designed to be called AFTER `syncProjects` so the local Project
 * rows already exist. For every Bitrix-mirrored Project we fetch
 * `sonet_group.user.get` (returns all members of that group),
 * resolve each Bitrix user to a local User by `bitrixUserId`, and
 * upsert ProjectBitrixMember.
 *
 * Removals: any local membership row whose bitrixUserId is no longer
 * present in the upstream group is deleted — the user really did
 * leave the workgroup. Without this leg, our visibility list would
 * drift wider than Bitrix's over time.
 *
 * Cost: one `sonet_group.user.get` per project per run. With ~50
 * Bitrix groups and the client's built-in 3-RPS throttle that's
 * ~17 seconds — fine for a nightly job, ok for an on-demand sync.
 */
export async function syncProjectBitrixMembers(
  prisma: PrismaClient,
  client: Bitrix24Client,
  opts: { projectIds?: string[] } = {},
): Promise<SyncProjectMembersResult> {
  // Either an explicit subset (used by per-user sync to limit scope)
  // or every Bitrix-mirrored Project in the DB.
  const projects = await prisma.project.findMany({
    where: {
      externalSource: 'bitrix24',
      externalId: { not: null },
      ...(opts.projectIds ? { id: { in: opts.projectIds } } : {}),
    },
    select: { id: true, externalId: true },
  });

  const stats: SyncProjectMembersResult = {
    projectsScanned: projects.length,
    membershipsTotal: 0,
    membershipsAdded: 0,
    membershipsRemoved: 0,
  };
  if (projects.length === 0) return stats;

  // Pre-load every User with a bitrixUserId so we can resolve in
  // memory without N+1 lookups per member.
  const linkedUsers = await prisma.user.findMany({
    where: { bitrixUserId: { not: null } },
    select: { id: true, bitrixUserId: true },
  });
  const userIdByBitrixId = new Map(
    linkedUsers
      .filter((u): u is typeof u & { bitrixUserId: string } => !!u.bitrixUserId)
      .map((u) => [u.bitrixUserId, u.id]),
  );

  type BxGroupUser = { USER_ID: string; ROLE?: string };

  for (const p of projects) {
    if (!p.externalId) continue;
    let members: BxGroupUser[];
    try {
      members = await client.all<BxGroupUser>('sonet_group.user.get', {
        ID: p.externalId,
      });
    } catch (e) {
      // Don't fail the whole run on one bad group — log and skip.
      // eslint-disable-next-line no-console
      console.warn(`[bitrix:syncMembers] sonet_group.user.get failed for group ${p.externalId}:`, e);
      continue;
    }

    // Existing rows for this project.
    const existing = await prisma.projectBitrixMember.findMany({
      where: { projectId: p.id },
      select: { id: true, bitrixUserId: true },
    });
    const existingByBitrixId = new Map(existing.map((r) => [r.bitrixUserId, r.id]));
    const upstreamBitrixIds = new Set(members.map((m) => String(m.USER_ID)));

    // Upsert each upstream member.
    for (const m of members) {
      const bxId = String(m.USER_ID);
      if (!bxId) continue;
      const localUserId = userIdByBitrixId.get(bxId) ?? null;
      if (existingByBitrixId.has(bxId)) {
        // Re-link userId / refresh role on every run — cheap and
        // catches the case where the local User was created/linked
        // after the previous sync.
        await prisma.projectBitrixMember.update({
          where: {
            projectId_bitrixUserId: { projectId: p.id, bitrixUserId: bxId },
          },
          data: { userId: localUserId, role: m.ROLE ?? null, syncedAt: new Date() },
        });
      } else {
        await prisma.projectBitrixMember.create({
          data: {
            projectId: p.id,
            bitrixUserId: bxId,
            userId: localUserId,
            role: m.ROLE ?? null,
          },
        });
        stats.membershipsAdded++;
      }
      stats.membershipsTotal++;
    }

    // Remove rows for users who left the workgroup upstream.
    const toRemove = existing.filter((r) => !upstreamBitrixIds.has(r.bitrixUserId));
    if (toRemove.length) {
      await prisma.projectBitrixMember.deleteMany({
        where: { id: { in: toRemove.map((r) => r.id) } },
      });
      stats.membershipsRemoved += toRemove.length;
    }
  }
  return stats;
}
