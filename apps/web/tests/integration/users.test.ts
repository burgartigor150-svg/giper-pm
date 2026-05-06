import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import { prisma } from '@giper/db';
import {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  setUserActive,
  resetPassword,
  changeOwnPassword,
} from '@/lib/users';
import { makeUser, sessionUser } from './helpers/factories';

async function expectDomain(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ name: 'DomainError', code });
}

describe('listUsers', () => {
  it('returns only active by default', async () => {
    await makeUser({ email: 'a@t', name: 'A', isActive: true });
    await makeUser({ email: 'b@t', name: 'B', isActive: false });
    const list = await listUsers();
    expect(list).toHaveLength(1);
    expect(list[0]!.email).toBe('a@t');
  });

  it('includeInactive=true returns everyone', async () => {
    await makeUser({ email: 'c@t', name: 'C', isActive: true });
    await makeUser({ email: 'd@t', name: 'D', isActive: false });
    const list = await listUsers({ includeInactive: true });
    expect(list).toHaveLength(2);
  });

  it('orders inactive last, then by name', async () => {
    await makeUser({ email: 'z@t', name: 'Zed', isActive: true });
    await makeUser({ email: 'a@t', name: 'Alex', isActive: true });
    await makeUser({ email: 'm@t', name: 'Mid', isActive: false });
    const list = await listUsers({ includeInactive: true });
    expect(list.map((u) => u.name)).toEqual(['Alex', 'Zed', 'Mid']);
  });
});

describe('getUserById', () => {
  it('returns user shape', async () => {
    const u = await makeUser({ email: 'g@t', name: 'G' });
    const got = await getUserById(u.id);
    expect(got.email).toBe('g@t');
    expect(got).not.toHaveProperty('passwordHash');
  });

  it('missing → NOT_FOUND', async () => {
    await expectDomain(getUserById('no-such'), 'NOT_FOUND');
  });
});

describe('createUser', () => {
  it('ADMIN creates → returns plaintext temp password ONCE, hash matches via bcrypt', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const { user, tempPassword } = await createUser(
      { email: 'new@t.local', name: 'New', role: 'MEMBER' },
      sessionUser(admin),
    );
    expect(typeof tempPassword).toBe('string');
    expect(tempPassword.length).toBeGreaterThanOrEqual(12);
    expect(user.email).toBe('new@t.local');
    expect(user.role).toBe('MEMBER');

    const fresh = await prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true, mustChangePassword: true },
    });
    expect(fresh?.mustChangePassword).toBe(true);
    expect(await bcrypt.compare(tempPassword, fresh!.passwordHash!)).toBe(true);
  });

  it('non-ADMIN actor → INSUFFICIENT_PERMISSIONS', async () => {
    for (const role of ['PM', 'MEMBER', 'VIEWER'] as const) {
      const actor = await makeUser({ role });
      await expectDomain(
        createUser(
          { email: `x-${role}@t`, name: 'x', role: 'MEMBER' },
          sessionUser(actor),
        ),
        'INSUFFICIENT_PERMISSIONS',
      );
    }
  });

  it('duplicate email → CONFLICT', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    await createUser(
      { email: 'dup@t', name: 'A', role: 'MEMBER' },
      sessionUser(admin),
    );
    await expectDomain(
      createUser({ email: 'dup@t', name: 'B', role: 'MEMBER' }, sessionUser(admin)),
      'CONFLICT',
    );
  });
});

describe('updateUser', () => {
  it('ADMIN can change name and role', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const target = await makeUser({ role: 'MEMBER', name: 'Old' });
    const updated = await updateUser(
      target.id,
      { name: 'New Name', role: 'PM' },
      sessionUser(admin),
    );
    expect(updated.name).toBe('New Name');
    expect(updated.role).toBe('PM');
  });

  it('non-ADMIN actor → INSUFFICIENT_PERMISSIONS', async () => {
    const actor = await makeUser({ role: 'PM' });
    const target = await makeUser({ role: 'MEMBER' });
    await expectDomain(
      updateUser(target.id, { name: 'x' }, sessionUser(actor)),
      'INSUFFICIENT_PERMISSIONS',
    );
  });

  it('missing user → NOT_FOUND', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    await expectDomain(
      updateUser('no-id', { name: 'x' }, sessionUser(admin)),
      'NOT_FOUND',
    );
  });

  it('cannot demote single ADMIN (themselves)', async () => {
    const onlyAdmin = await makeUser({ role: 'ADMIN' });
    await expectDomain(
      updateUser(onlyAdmin.id, { role: 'MEMBER' }, sessionUser(onlyAdmin)),
      'VALIDATION',
    );
  });

  it('can demote self when another active ADMIN exists', async () => {
    const admin1 = await makeUser({ role: 'ADMIN' });
    await makeUser({ role: 'ADMIN' });
    const updated = await updateUser(
      admin1.id,
      { role: 'PM' },
      sessionUser(admin1),
    );
    expect(updated.role).toBe('PM');
  });

  it('partial input — only provided fields applied', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const target = await makeUser({ role: 'MEMBER', name: 'Stay' });
    const updated = await updateUser(
      target.id,
      { role: 'PM' },
      sessionUser(admin),
    );
    expect(updated.name).toBe('Stay');
    expect(updated.role).toBe('PM');
  });
});

describe('setUserActive', () => {
  it('ADMIN can deactivate someone else (soft-deletes)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const t = await makeUser({ role: 'MEMBER' });
    await setUserActive(t.id, false, sessionUser(admin));
    const fresh = await prisma.user.findUnique({
      where: { id: t.id },
      select: { isActive: true, deletedAt: true },
    });
    expect(fresh?.isActive).toBe(false);
    expect(fresh?.deletedAt).toBeInstanceOf(Date);
  });

  it('reactivation clears deletedAt', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const t = await makeUser({ role: 'MEMBER' });
    await setUserActive(t.id, false, sessionUser(admin));
    await setUserActive(t.id, true, sessionUser(admin));
    const fresh = await prisma.user.findUnique({
      where: { id: t.id },
      select: { isActive: true, deletedAt: true },
    });
    expect(fresh?.isActive).toBe(true);
    expect(fresh?.deletedAt).toBeNull();
  });

  it('cannot deactivate self', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    await expectDomain(
      setUserActive(admin.id, false, sessionUser(admin)),
      'VALIDATION',
    );
  });

  // NOTE on "cannot deactivate single ADMIN":
  // The guard only fires when target.role === 'ADMIN' AND there are no other active
  // ADMINs besides the target. Actor must also be ADMIN (passes the role check).
  // We simulate: actor is an ADMIN whose "active" flag is forced false in the DB
  // (so they don't count in otherAdminCount), they retain role=ADMIN so the actor
  // role check still passes. Their session still shows role=ADMIN.
  it('cannot deactivate single active ADMIN (target is sole active ADMIN)', async () => {
    const target = await makeUser({ role: 'ADMIN' });
    const actor = await makeUser({ role: 'ADMIN' });
    // Force actor to inactive at DB level so `otherAdminCount` (which filters by
    // isActive: true and id != target.id) returns 0.
    await prisma.user.update({
      where: { id: actor.id },
      data: { isActive: false },
    });
    // The actor's session still has role=ADMIN — that's what we pass in.
    await expectDomain(
      setUserActive(target.id, false, sessionUser(actor)),
      'VALIDATION',
    );
  });

  it('non-ADMIN actor → INSUFFICIENT_PERMISSIONS', async () => {
    const pm = await makeUser({ role: 'PM' });
    const t = await makeUser({ role: 'MEMBER' });
    await expectDomain(
      setUserActive(t.id, false, sessionUser(pm)),
      'INSUFFICIENT_PERMISSIONS',
    );
  });

  it('missing user → NOT_FOUND', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    await expectDomain(
      setUserActive('no-id', false, sessionUser(admin)),
      'NOT_FOUND',
    );
  });
});

describe('resetPassword', () => {
  it('ADMIN reset → returns new plaintext, mustChangePassword=true, hash updated', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const t = await makeUser({ role: 'MEMBER', password: 'old-pass' });
    const before = await prisma.user.findUnique({
      where: { id: t.id },
      select: { passwordHash: true },
    });

    const { tempPassword } = await resetPassword(t.id, sessionUser(admin));
    expect(typeof tempPassword).toBe('string');
    expect(tempPassword.length).toBeGreaterThanOrEqual(12);

    const fresh = await prisma.user.findUnique({
      where: { id: t.id },
      select: { passwordHash: true, mustChangePassword: true },
    });
    expect(fresh?.mustChangePassword).toBe(true);
    expect(fresh?.passwordHash).not.toBe(before?.passwordHash);
    expect(await bcrypt.compare(tempPassword, fresh!.passwordHash!)).toBe(true);
  });

  it('non-ADMIN actor → INSUFFICIENT_PERMISSIONS', async () => {
    const pm = await makeUser({ role: 'PM' });
    const t = await makeUser({ role: 'MEMBER' });
    await expectDomain(
      resetPassword(t.id, sessionUser(pm)),
      'INSUFFICIENT_PERMISSIONS',
    );
  });

  it('refuses if user is inactive (VALIDATION)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const t = await makeUser({ isActive: false });
    await expectDomain(resetPassword(t.id, sessionUser(admin)), 'VALIDATION');
  });

  it('missing user → NOT_FOUND', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    await expectDomain(resetPassword('no-id', sessionUser(admin)), 'NOT_FOUND');
  });
});

describe('changeOwnPassword', () => {
  it('happy path: updates hash, clears mustChangePassword, sets lastPasswordChangeAt', async () => {
    const me = await makeUser({ password: 'current-pass', mustChangePassword: true });
    await changeOwnPassword(
      {
        currentPassword: 'current-pass',
        newPassword: 'new-strong-pass',
        confirmPassword: 'new-strong-pass',
      },
      sessionUser(me),
    );
    const fresh = await prisma.user.findUnique({
      where: { id: me.id },
      select: {
        passwordHash: true,
        mustChangePassword: true,
        lastPasswordChangeAt: true,
      },
    });
    expect(fresh?.mustChangePassword).toBe(false);
    expect(fresh?.lastPasswordChangeAt).toBeInstanceOf(Date);
    expect(await bcrypt.compare('new-strong-pass', fresh!.passwordHash!)).toBe(true);
  });

  it('rejects wrong current password', async () => {
    const me = await makeUser({ password: 'right-pass' });
    await expectDomain(
      changeOwnPassword(
        {
          currentPassword: 'wrong',
          newPassword: 'new-strong-pass',
          confirmPassword: 'new-strong-pass',
        },
        sessionUser(me),
      ),
      'VALIDATION',
    );
  });

  it('rejects new === current', async () => {
    const me = await makeUser({ password: 'same-pass-1' });
    await expectDomain(
      changeOwnPassword(
        {
          currentPassword: 'same-pass-1',
          newPassword: 'same-pass-1',
          confirmPassword: 'same-pass-1',
        },
        sessionUser(me),
      ),
      'VALIDATION',
    );
  });

  it('user without passwordHash → VALIDATION', async () => {
    const me = await makeUser();
    await prisma.user.update({
      where: { id: me.id },
      data: { passwordHash: null },
    });
    await expectDomain(
      changeOwnPassword(
        {
          currentPassword: 'whatever',
          newPassword: 'new-strong-pass',
          confirmPassword: 'new-strong-pass',
        },
        sessionUser(me),
      ),
      'VALIDATION',
    );
  });
});
