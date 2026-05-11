import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import { syncUsers, Bitrix24Client, type BxUser } from '@giper/integrations/bitrix24';
import { makeUser } from './helpers/factories';

/**
 * Integration test for the Bitrix → giper user sync. We use a tiny fake
 * Bitrix24Client (only `all` is called by syncUsers). The real prisma
 * client is wired into the suite by tests/integration/setup.ts.
 *
 * Source under test: packages/integrations/src/bitrix24/syncUsers.ts
 */

function fakeClient(users: BxUser[]): Bitrix24Client {
  // Only `all` is consumed by syncUsers — cast through unknown to satisfy
  // the type without re-implementing the whole client surface.
  return {
    async all<T>(method: string): Promise<T[]> {
      void method;
      return users as unknown as T[];
    },
  } as unknown as Bitrix24Client;
}

describe('syncUsers — match by email', () => {
  it('links existing user by lower-cased email, stores bitrixUserId, updates auto-named users', async () => {
    // Pre-existing local user with empty name → should be auto-named.
    const local = await prisma.user.create({
      data: {
        email: 'mixed.case@giper.fm',
        // Name == localPart → "looksAutoNamed"
        name: 'mixed.case',
        role: 'MEMBER',
        isActive: false,
      },
    });
    const result = await syncUsers(
      prisma,
      fakeClient([
        {
          ID: '777',
          ACTIVE: true,
          NAME: 'Mixed',
          LAST_NAME: 'Case',
          EMAIL: 'Mixed.Case@giper.fm',
          PERSONAL_PHOTO: 'https://x/y.jpg',
          TIME_ZONE: 'Europe/Moscow',
        },
      ]),
    );
    expect(result.totalSeen).toBe(1);
    expect(result.matched).toBe(1);
    expect(result.created).toBe(0);
    const updated = await prisma.user.findUnique({ where: { id: local.id } });
    expect(updated?.bitrixUserId).toBe('777');
    expect(updated?.name).toBe('Mixed Case');
    expect(updated?.image).toBe('https://x/y.jpg');
  });

  it('does NOT touch isActive on an existing user when dept allowlist is empty', async () => {
    await prisma.user.create({
      data: {
        email: 'someone@giper.fm',
        name: 'Someone',
        role: 'MEMBER',
        isActive: false,
      },
    });
    await syncUsers(
      prisma,
      fakeClient([
        { ID: '888', ACTIVE: true, EMAIL: 'someone@giper.fm', UF_DEPARTMENT: ['10'] },
      ]),
      { activeDepartmentIds: [] },
    );
    const u = await prisma.user.findUnique({ where: { email: 'someone@giper.fm' } });
    expect(u?.isActive).toBe(false);
  });

  it('flips inactive→active when UF_DEPARTMENT intersects allowlist', async () => {
    await prisma.user.create({
      data: {
        email: 'dev@giper.fm',
        name: 'Dev User',
        role: 'MEMBER',
        isActive: false,
      },
    });
    await syncUsers(
      prisma,
      fakeClient([
        { ID: '999', ACTIVE: true, EMAIL: 'dev@giper.fm', UF_DEPARTMENT: ['44', '55'] },
      ]),
      { activeDepartmentIds: ['55'] },
    );
    const u = await prisma.user.findUnique({ where: { email: 'dev@giper.fm' } });
    expect(u?.isActive).toBe(true);
  });

  it('does NOT auto-deactivate someone who fell out of the allowlist', async () => {
    // This is deliberate: admin may have manually activated them.
    await prisma.user.create({
      data: { email: 'staff@giper.fm', name: 'Staff', role: 'MEMBER', isActive: true },
    });
    await syncUsers(
      prisma,
      fakeClient([
        { ID: '1000', ACTIVE: true, EMAIL: 'staff@giper.fm', UF_DEPARTMENT: ['9999'] },
      ]),
      { activeDepartmentIds: ['1', '2'] },
    );
    const u = await prisma.user.findUnique({ where: { email: 'staff@giper.fm' } });
    expect(u?.isActive).toBe(true);
  });
});

describe('syncUsers — createMissing', () => {
  it('with createMissing=false: unmatched Bitrix users are skipped', async () => {
    const result = await syncUsers(
      prisma,
      fakeClient([
        { ID: '1', ACTIVE: true, EMAIL: 'newperson@giper.fm', NAME: 'New' },
      ]),
    );
    expect(result.created).toBe(0);
    expect(await prisma.user.count({ where: { email: 'newperson@giper.fm' } })).toBe(0);
  });

  it('with createMissing=true: stub user is created INACTIVE (no allowlist hit)', async () => {
    const result = await syncUsers(
      prisma,
      fakeClient([
        {
          ID: '2',
          ACTIVE: true,
          EMAIL: 'stub@giper.fm',
          NAME: 'Stub',
          LAST_NAME: 'Person',
        },
      ]),
      { createMissing: true },
    );
    expect(result.created).toBe(1);
    const u = await prisma.user.findUnique({ where: { email: 'stub@giper.fm' } });
    expect(u?.isActive).toBe(false);
    expect(u?.bitrixUserId).toBe('2');
    expect(u?.name).toBe('Stub Person');
  });

  it('createMissing + dept-allowlist hit → user born active (only when they have a real email)', async () => {
    const result = await syncUsers(
      prisma,
      fakeClient([
        {
          ID: '3',
          ACTIVE: true,
          EMAIL: 'webdev@giper.fm',
          NAME: 'Dev',
          UF_DEPARTMENT: ['55'],
        },
      ]),
      { createMissing: true, activeDepartmentIds: ['55'] },
    );
    expect(result.created).toBe(1);
    const u = await prisma.user.findUnique({ where: { email: 'webdev@giper.fm' } });
    expect(u?.isActive).toBe(true);
  });

  it('createMissing for a Bitrix user without email synthesizes a unique stub email', async () => {
    const result = await syncUsers(
      prisma,
      fakeClient([
        { ID: '4242', ACTIVE: false, NAME: 'Bot', UF_DEPARTMENT: ['55'] },
      ]),
      { createMissing: true, activeDepartmentIds: ['55'] },
    );
    expect(result.created).toBe(1);
    const u = await prisma.user.findUnique({ where: { email: 'bitrix-4242@bitrix.local' } });
    expect(u).not.toBeNull();
    // Synthetic-email stubs always start INACTIVE, even when their dept
    // is in the allowlist — they can't log in anyway.
    expect(u?.isActive).toBe(false);
    expect(u?.bitrixUserId).toBe('4242');
  });
});

describe('syncUsers — link durability', () => {
  it('once linked by bitrixUserId, an upstream email change does NOT break the match', async () => {
    const me = await makeUser({ email: 'first@giper.fm', name: 'First Name' });
    await prisma.user.update({
      where: { id: me.id },
      data: { bitrixUserId: '7777' },
    });
    // Upstream Bitrix flipped their email — but ID is the same.
    const result = await syncUsers(
      prisma,
      fakeClient([
        {
          ID: '7777',
          ACTIVE: true,
          EMAIL: 'renamed@giper.fm',
          NAME: 'First',
          LAST_NAME: 'Name',
        },
      ]),
    );
    expect(result.matched).toBe(1);
    expect(result.created).toBe(0);
    const after = await prisma.user.findUnique({ where: { id: me.id } });
    // We don't rewrite the email — that would clobber the login —
    // but the ID stays linked.
    expect(after?.email).toBe('first@giper.fm');
    expect(after?.bitrixUserId).toBe('7777');
  });
});
