import { describe, it, expect } from 'vitest';

/**
 * Integration tests for the SSO allowlist (resolveSsoUser). This is the
 * security gate the Google signIn callback delegates to: only verified emails
 * matching an existing ACTIVE user are admitted; no auto-provisioning; role
 * always comes from our DB. No real IdP needed — synthetic inputs.
 *
 * Source: apps/web/lib/authProvisioning.ts
 */

import { prisma } from '@giper/db';
import { resolveSsoUser } from '@/lib/authProvisioning';
import { makeUser } from './helpers/factories';

describe('resolveSsoUser (SSO allowlist)', () => {
  it('admits a verified email matching an active user, returning DB role', async () => {
    const u = await makeUser({ role: 'PM', email: 'sales@team.test' });
    const r = await resolveSsoUser({ email: 'sales@team.test', emailVerified: true });
    expect(r).toEqual({ id: u.id, role: 'PM' });
  });

  it('rejects an unverified email', async () => {
    await makeUser({ email: 'x@team.test' });
    expect(await resolveSsoUser({ email: 'x@team.test', emailVerified: false })).toBeNull();
  });

  it('rejects an unknown email (no auto-provisioning)', async () => {
    expect(await resolveSsoUser({ email: 'nobody@nowhere.test', emailVerified: true })).toBeNull();
    const count = await prisma.user.count({ where: { email: 'nobody@nowhere.test' } });
    expect(count).toBe(0); // nothing was created
  });

  it('rejects an inactive user', async () => {
    await makeUser({ email: 'gone@team.test', isActive: false });
    expect(await resolveSsoUser({ email: 'gone@team.test', emailVerified: true })).toBeNull();
  });

  it('rejects a soft-deleted user', async () => {
    const u = await makeUser({ email: 'deleted@team.test' });
    await prisma.user.update({ where: { id: u.id }, data: { deletedAt: new Date() } });
    expect(await resolveSsoUser({ email: 'deleted@team.test', emailVerified: true })).toBeNull();
  });

  it('matches email case-insensitively', async () => {
    const u = await makeUser({ email: 'mixed@team.test' });
    const r = await resolveSsoUser({ email: 'Mixed@Team.TEST', emailVerified: true });
    expect(r?.id).toBe(u.id);
  });

  it('rejects an empty email', async () => {
    expect(await resolveSsoUser({ email: '', emailVerified: true })).toBeNull();
    expect(await resolveSsoUser({ email: null, emailVerified: true })).toBeNull();
  });
});
