import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import { syncProjects, Bitrix24Client, type BxWorkgroup } from '@giper/integrations/bitrix24';
import { makeUser } from './helpers/factories';

/**
 * Bitrix workgroup → giper Project mirror. Tests cover:
 *   - matching by (externalSource, externalId)
 *   - owner resolution via bitrixUserId (with admin fallback)
 *   - status mapping: CLOSED='Y' / ACTIVE='N' → ARCHIVED
 *   - per-user mode (forBitrixUserId) hits sonet_group.user.groups
 *   - extraGroupIds union
 *   - key collision: synthetic suffix never overwrites a hand-made project
 *
 * Source: packages/integrations/src/bitrix24/syncProjects.ts
 */

/**
 * Programmable fake Bitrix client. The real one paginates via the `all`
 * helper; syncProjects only calls `all`. We answer based on method + a
 * tiny FILTER spy.
 */
function fakeClient(handlers: {
  workgroups?: BxWorkgroup[];
  memberships?: Array<{ GROUP_ID: string; GROUP_NAME: string; ROLE: string }>;
  /** Optional filter check — fakeClient calls this with raw params. */
  onCall?: (method: string, params: unknown) => void;
}): Bitrix24Client {
  return {
    async all<T>(method: string, params: unknown): Promise<T[]> {
      handlers.onCall?.(method, params);
      if (method === 'sonet_group.user.groups') {
        return (handlers.memberships ?? []) as unknown as T[];
      }
      if (method === 'sonet_group.get') {
        // If the test asked for a filter by ID list, honour it.
        const p = params as { FILTER?: { ID?: string[] } } | undefined;
        const filterIds = p?.FILTER?.ID;
        const all = handlers.workgroups ?? [];
        if (Array.isArray(filterIds)) {
          return all.filter((g) => filterIds.includes(String(g.ID))) as unknown as T[];
        }
        return all as unknown as T[];
      }
      return [] as T[];
    },
  } as unknown as Bitrix24Client;
}

async function makeAdmin() {
  return makeUser({ role: 'ADMIN', isActive: true });
}

describe('syncProjects — global mode', () => {
  it('creates a Project per active workgroup; admin is the fallback owner', async () => {
    const admin = await makeAdmin();
    const result = await syncProjects(
      prisma,
      fakeClient({
        workgroups: [
          { ID: '101', NAME: 'Alpha Project', ACTIVE: 'Y', CLOSED: 'N' },
          { ID: '102', NAME: 'Beta', ACTIVE: 'Y', CLOSED: 'N' },
        ],
      }),
    );
    expect(result.totalSeen).toBe(2);
    expect(result.created).toBe(2);
    const alpha = await prisma.project.findUnique({
      where: { externalSource_externalId: { externalSource: 'bitrix24', externalId: '101' } },
    });
    expect(alpha?.ownerId).toBe(admin.id);
    expect(alpha?.name).toBe('Alpha Project');
    // Owner gets a LEAD ProjectMember row for the project list.
    const members = await prisma.projectMember.findMany({ where: { projectId: alpha!.id } });
    expect(members).toHaveLength(1);
    expect(members[0]!.role).toBe('LEAD');
  });

  it('skips everything when no ADMIN exists in our DB (defensive — no orphan projects)', async () => {
    const result = await syncProjects(
      prisma,
      fakeClient({
        workgroups: [{ ID: '999', NAME: 'Orphan', ACTIVE: 'Y', CLOSED: 'N' }],
      }),
    );
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('owner resolves through bitrixUserId when the Bitrix owner is in our DB', async () => {
    await makeAdmin();
    const realOwner = await makeUser({ role: 'MEMBER' });
    await prisma.user.update({
      where: { id: realOwner.id },
      data: { bitrixUserId: 'BX-555' },
    });
    await syncProjects(
      prisma,
      fakeClient({
        workgroups: [
          { ID: '200', NAME: 'Owned', ACTIVE: 'Y', CLOSED: 'N', OWNER_ID: 'BX-555' },
        ],
      }),
    );
    const p = await prisma.project.findUnique({
      where: { externalSource_externalId: { externalSource: 'bitrix24', externalId: '200' } },
    });
    expect(p?.ownerId).toBe(realOwner.id);
  });

  it('subsequent sync repairs owner when bitrixUserId mapping appears later', async () => {
    const admin = await makeAdmin();
    // First sync: no owner mapping → admin fallback.
    await syncProjects(
      prisma,
      fakeClient({
        workgroups: [
          { ID: '300', NAME: 'Repair', ACTIVE: 'Y', CLOSED: 'N', OWNER_ID: 'BX-77' },
        ],
      }),
    );
    let p = await prisma.project.findUnique({
      where: { externalSource_externalId: { externalSource: 'bitrix24', externalId: '300' } },
    });
    expect(p?.ownerId).toBe(admin.id);
    // Then the user is linked.
    const realOwner = await makeUser({ role: 'MEMBER' });
    await prisma.user.update({
      where: { id: realOwner.id },
      data: { bitrixUserId: 'BX-77' },
    });
    const result = await syncProjects(
      prisma,
      fakeClient({
        workgroups: [
          { ID: '300', NAME: 'Repair', ACTIVE: 'Y', CLOSED: 'N', OWNER_ID: 'BX-77' },
        ],
      }),
    );
    expect(result.updated).toBe(1);
    p = await prisma.project.findUnique({
      where: { externalSource_externalId: { externalSource: 'bitrix24', externalId: '300' } },
    });
    expect(p?.ownerId).toBe(realOwner.id);
  });

  it('CLOSED workgroup → status=ARCHIVED on create; archivedAt is set on subsequent update', async () => {
    await makeAdmin();
    await syncProjects(
      prisma,
      fakeClient({
        workgroups: [{ ID: '400', NAME: 'Old', ACTIVE: 'N', CLOSED: 'Y' }],
      }),
    );
    let p = await prisma.project.findUnique({
      where: { externalSource_externalId: { externalSource: 'bitrix24', externalId: '400' } },
    });
    // BUG/quirk noted: the create path leaves archivedAt=null. Only the
    // update path sets it. If/when the create path is fixed to set
    // archivedAt directly, swap the next assertion to .toBeInstanceOf(Date).
    expect(p?.status).toBe('ARCHIVED');
    expect(p?.archivedAt).toBeNull();
    // After the upstream changes the name (forcing a real update), the
    // archivedAt timestamp does get set.
    await syncProjects(
      prisma,
      fakeClient({
        workgroups: [{ ID: '400', NAME: 'Old (renamed)', ACTIVE: 'N', CLOSED: 'Y' }],
      }),
    );
    p = await prisma.project.findUnique({
      where: { externalSource_externalId: { externalSource: 'bitrix24', externalId: '400' } },
    });
    expect(p?.archivedAt).toBeInstanceOf(Date);
  });
});

describe('syncProjects — per-user mode', () => {
  it('forBitrixUserId fetches sonet_group.user.groups and filters by ID', async () => {
    await makeAdmin();
    let lastCall = '';
    const result = await syncProjects(
      prisma,
      fakeClient({
        memberships: [
          { GROUP_ID: '777', GROUP_NAME: 'Mine', ROLE: 'A' },
        ],
        workgroups: [
          { ID: '777', NAME: 'Mine', ACTIVE: 'Y', CLOSED: 'N' },
          { ID: '888', NAME: 'NotMine', ACTIVE: 'Y', CLOSED: 'N' },
        ],
        onCall: (m) => { lastCall = m; },
      }),
      { forBitrixUserId: 'BX-1' },
    );
    expect(lastCall).toBe('sonet_group.get');
    expect(result.totalSeen).toBe(1);
    expect(result.created).toBe(1);
  });

  it('forBitrixUserId with no memberships and no extras → zero work, no skips', async () => {
    await makeAdmin();
    const result = await syncProjects(
      prisma,
      fakeClient({ memberships: [] }),
      { forBitrixUserId: 'BX-NOBODY' },
    );
    expect(result).toEqual({ totalSeen: 0, created: 0, updated: 0, skipped: 0 });
  });

  it('extraGroupIds are unioned with memberships', async () => {
    await makeAdmin();
    const result = await syncProjects(
      prisma,
      fakeClient({
        memberships: [{ GROUP_ID: '1', GROUP_NAME: 'a', ROLE: 'A' }],
        workgroups: [
          { ID: '1', NAME: 'one', ACTIVE: 'Y', CLOSED: 'N' },
          { ID: '2', NAME: 'two', ACTIVE: 'Y', CLOSED: 'N' },
        ],
      }),
      { forBitrixUserId: 'BX-X', extraGroupIds: ['2'] },
    );
    expect(result.created).toBe(2);
  });
});

describe('syncProjects — key collisions', () => {
  it('does not overwrite a hand-made project when its key collides with a Bitrix name', async () => {
    const admin = await makeAdmin();
    // Hand-made project with key=ALPH (slug of "Alpha").
    await prisma.project.create({
      data: {
        key: 'ALPH',
        name: 'My Alpha',
        ownerId: admin.id,
      },
    });
    await syncProjects(
      prisma,
      fakeClient({
        workgroups: [{ ID: '500', NAME: 'Alpha', ACTIVE: 'Y', CLOSED: 'N' }],
      }),
    );
    const mine = await prisma.project.findUnique({ where: { key: 'ALPH' } });
    expect(mine?.name).toBe('My Alpha');
    expect(mine?.externalSource).toBeNull();

    const mirror = await prisma.project.findUnique({
      where: { externalSource_externalId: { externalSource: 'bitrix24', externalId: '500' } },
    });
    expect(mirror).not.toBeNull();
    expect(mirror!.key).not.toBe('ALPH');
  });
});
