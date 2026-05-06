import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';

const mockMe = {
  id: '',
  role: 'ADMIN' as 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER',
  name: 'A',
  email: 'a@a',
  image: null,
  mustChangePassword: false,
};

const { signOutMock } = vi.hoisted(() => ({
  signOutMock: vi.fn(async (_opts?: { redirectTo?: string }) => {
    const e = new Error('NEXT_REDIRECT');
    (e as { digest?: string }).digest = 'NEXT_REDIRECT;/login?changed=1';
    throw e;
  }),
}));

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => mockMe),
  requireRole: vi.fn(async () => mockMe),
  signOut: signOutMock,
  signIn: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    const e = new Error('NEXT_REDIRECT');
    (e as { digest?: string }).digest = 'NEXT_REDIRECT;' + url;
    throw e;
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import {
  createUserAction,
  updateUserAction,
  setUserActiveAction,
  resetPasswordAction,
  changeOwnPasswordAction,
  searchUsers,
} from '@/actions/users';
import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { makeUser } from './helpers/factories';

beforeEach(() => {
  vi.mocked(revalidatePath).mockClear();
  signOutMock.mockClear();
  mockMe.role = 'ADMIN';
});

describe('searchUsers', () => {
  it('returns [] for queries shorter than 2 chars', async () => {
    const me = await makeUser({ role: 'ADMIN' });
    mockMe.id = me.id;
    const hits = await searchUsers('a');
    expect(hits).toEqual([]);
  });

  it('finds users by name/email', async () => {
    const me = await makeUser({ role: 'ADMIN', name: 'Bob' });
    await makeUser({ name: 'Alice Smith', email: 'alice@example.com' });
    await makeUser({ name: 'Other', email: 'other@example.com' });
    mockMe.id = me.id;

    const byName = await searchUsers('alice');
    expect(byName.find((u) => u.name === 'Alice Smith')).toBeTruthy();

    const byEmail = await searchUsers('example');
    expect(byEmail.length).toBeGreaterThanOrEqual(2);
  });

  it('does not return inactive users', async () => {
    const me = await makeUser({ role: 'ADMIN' });
    await makeUser({ name: 'Inactive Person', isActive: false });
    mockMe.id = me.id;

    const hits = await searchUsers('inactive');
    expect(hits).toHaveLength(0);
  });
});

describe('createUserAction', () => {
  it('creates a user (happy path)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const fd = new FormData();
    fd.set('email', 'NEW@Example.com');
    fd.set('name', 'New Person');
    fd.set('role', 'MEMBER');
    const res = await createUserAction(null, fd);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data?.id).toBeDefined();
      expect(res.data?.tempPassword).toMatch(/^[A-Za-z0-9]{12}$/);
    }
    expect(revalidatePath).toHaveBeenCalledWith('/settings/users');
    const created = await prisma.user.findUnique({ where: { email: 'new@example.com' } });
    expect(created?.role).toBe('MEMBER');
    expect(created?.mustChangePassword).toBe(true);
  });

  it('returns VALIDATION on missing email', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const fd = new FormData();
    fd.set('name', 'X');
    fd.set('role', 'MEMBER');
    const res = await createUserAction(null, fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
  });

  it('returns VALIDATION on bad role', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const fd = new FormData();
    fd.set('email', 'x@x.com');
    fd.set('name', 'X');
    fd.set('role', 'GOD');
    const res = await createUserAction(null, fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
  });

  it('returns INSUFFICIENT_PERMISSIONS for non-ADMIN', async () => {
    const pm = await makeUser({ role: 'PM' });
    mockMe.id = pm.id;
    mockMe.role = 'PM';
    const fd = new FormData();
    fd.set('email', 'newx@example.com');
    fd.set('name', 'X');
    fd.set('role', 'MEMBER');
    const res = await createUserAction(null, fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('returns CONFLICT on duplicate email', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    await makeUser({ email: 'dup@example.com' });
    const fd = new FormData();
    fd.set('email', 'dup@example.com');
    fd.set('name', 'X');
    fd.set('role', 'MEMBER');
    const res = await createUserAction(null, fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('CONFLICT');
  });
});

describe('updateUserAction', () => {
  it('updates user (happy path)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const other = await makeUser({ role: 'MEMBER', name: 'Old Name' });
    mockMe.id = admin.id;
    const fd = new FormData();
    fd.set('name', 'New Name');
    fd.set('role', 'PM');
    const res = await updateUserAction(other.id, null, fd);
    expect(res.ok).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith('/settings/users');
    expect(revalidatePath).toHaveBeenCalledWith(`/settings/users/${other.id}`);
    const fresh = await prisma.user.findUnique({ where: { id: other.id } });
    expect(fresh?.name).toBe('New Name');
    expect(fresh?.role).toBe('PM');
  });

  it('returns VALIDATION on bad input', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const other = await makeUser({ role: 'MEMBER' });
    mockMe.id = admin.id;

    const fd = new FormData();
    fd.set('role', 'NOT_A_ROLE');
    const res = await updateUserAction(other.id, null, fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
  });

  it('returns NOT_FOUND for unknown user', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;

    const fd = new FormData();
    fd.set('name', 'New');
    const res = await updateUserAction('00000000-0000-0000-0000-000000000000', null, fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_FOUND');
  });

  it('returns INSUFFICIENT_PERMISSIONS for non-ADMIN', async () => {
    const member = await makeUser({ role: 'MEMBER' });
    const other = await makeUser({ role: 'MEMBER' });
    mockMe.id = member.id;
    mockMe.role = 'MEMBER';

    const fd = new FormData();
    fd.set('name', 'New');
    const res = await updateUserAction(other.id, null, fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('returns VALIDATION when only ADMIN demotes themselves', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;

    const fd = new FormData();
    fd.set('role', 'MEMBER');
    const res = await updateUserAction(admin.id, null, fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
  });
});

describe('setUserActiveAction', () => {
  it('deactivates a user (happy path)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const other = await makeUser({ role: 'MEMBER' });
    mockMe.id = admin.id;
    const res = await setUserActiveAction(other.id, false);
    expect(res.ok).toBe(true);
    const fresh = await prisma.user.findUnique({ where: { id: other.id } });
    expect(fresh?.isActive).toBe(false);
    expect(fresh?.deletedAt).toBeInstanceOf(Date);
  });

  it('reactivates a user', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const other = await makeUser({ role: 'MEMBER', isActive: false });
    mockMe.id = admin.id;
    const res = await setUserActiveAction(other.id, true);
    expect(res.ok).toBe(true);
    const fresh = await prisma.user.findUnique({ where: { id: other.id } });
    expect(fresh?.isActive).toBe(true);
    expect(fresh?.deletedAt).toBeNull();
  });

  it('returns NOT_FOUND for unknown user', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const res = await setUserActiveAction('00000000-0000-0000-0000-000000000000', false);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_FOUND');
  });

  it('returns VALIDATION when admin deactivates self', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const res = await setUserActiveAction(admin.id, false);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
  });

  it('returns INSUFFICIENT_PERMISSIONS for non-ADMIN', async () => {
    const pm = await makeUser({ role: 'PM' });
    const other = await makeUser({ role: 'MEMBER' });
    mockMe.id = pm.id;
    mockMe.role = 'PM';
    const res = await setUserActiveAction(other.id, false);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });
});

describe('resetPasswordAction', () => {
  it('resets a user password (happy path)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const target = await makeUser({ role: 'MEMBER', mustChangePassword: false });
    mockMe.id = admin.id;

    const res = await resetPasswordAction(target.id);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data?.tempPassword).toMatch(/^[A-Za-z0-9]{12}$/);
    }

    const fresh = await prisma.user.findUnique({ where: { id: target.id } });
    expect(fresh?.mustChangePassword).toBe(true);
  });

  it('returns NOT_FOUND for unknown id', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const res = await resetPasswordAction('00000000-0000-0000-0000-000000000000');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_FOUND');
  });

  it('returns VALIDATION for inactive user', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const inactive = await makeUser({ isActive: false });
    mockMe.id = admin.id;
    const res = await resetPasswordAction(inactive.id);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
  });

  it('returns INSUFFICIENT_PERMISSIONS for non-ADMIN', async () => {
    const pm = await makeUser({ role: 'PM' });
    const target = await makeUser({ role: 'MEMBER' });
    mockMe.id = pm.id;
    mockMe.role = 'PM';
    const res = await resetPasswordAction(target.id);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });
});

describe('changeOwnPasswordAction', () => {
  it('changes own password and signs out', async () => {
    const me = await makeUser({ role: 'MEMBER', password: 'oldPassword1' });
    mockMe.id = me.id;
    mockMe.role = 'MEMBER';
    const fd = new FormData();
    fd.set('currentPassword', 'oldPassword1');
    fd.set('newPassword', 'newPassword2');
    fd.set('confirmPassword', 'newPassword2');
    await expect(changeOwnPasswordAction(null, fd)).rejects.toThrow('NEXT_REDIRECT');
    expect(signOutMock).toHaveBeenCalledWith({ redirectTo: '/login?changed=1' });
    const fresh = await prisma.user.findUnique({ where: { id: me.id } });
    expect(fresh?.mustChangePassword).toBe(false);
    expect(fresh?.lastPasswordChangeAt).toBeInstanceOf(Date);
    const matches = await bcrypt.compare('newPassword2', fresh?.passwordHash ?? '');
    expect(matches).toBe(true);
  });

  it('returns VALIDATION when passwords mismatch', async () => {
    const me = await makeUser({ role: 'MEMBER', password: 'oldPassword1' });
    mockMe.id = me.id;
    mockMe.role = 'MEMBER';

    const fd = new FormData();
    fd.set('currentPassword', 'oldPassword1');
    fd.set('newPassword', 'newPassword2');
    fd.set('confirmPassword', 'differentPwd3');

    const res = await changeOwnPasswordAction(null, fd);
    expect(res?.ok).toBe(false);
    if (res && !res.ok) expect(res.error.code).toBe('VALIDATION');
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it('returns VALIDATION when newPassword is too short', async () => {
    const me = await makeUser({ role: 'MEMBER', password: 'oldPassword1' });
    mockMe.id = me.id;
    mockMe.role = 'MEMBER';

    const fd = new FormData();
    fd.set('currentPassword', 'oldPassword1');
    fd.set('newPassword', 'short');
    fd.set('confirmPassword', 'short');

    const res = await changeOwnPasswordAction(null, fd);
    expect(res?.ok).toBe(false);
    if (res && !res.ok) expect(res.error.code).toBe('VALIDATION');
  });

  it('returns VALIDATION when current password is wrong', async () => {
    const me = await makeUser({ role: 'MEMBER', password: 'oldPassword1' });
    mockMe.id = me.id;
    mockMe.role = 'MEMBER';

    const fd = new FormData();
    fd.set('currentPassword', 'WRONG_PASSWORD');
    fd.set('newPassword', 'newPassword2');
    fd.set('confirmPassword', 'newPassword2');

    const res = await changeOwnPasswordAction(null, fd);
    expect(res?.ok).toBe(false);
    if (res && !res.ok) expect(res.error.code).toBe('VALIDATION');
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it('returns VALIDATION when new password equals current', async () => {
    const me = await makeUser({ role: 'MEMBER', password: 'samePassword1' });
    mockMe.id = me.id;
    mockMe.role = 'MEMBER';

    const fd = new FormData();
    fd.set('currentPassword', 'samePassword1');
    fd.set('newPassword', 'samePassword1');
    fd.set('confirmPassword', 'samePassword1');

    const res = await changeOwnPasswordAction(null, fd);
    expect(res?.ok).toBe(false);
    if (res && !res.ok) expect(res.error.code).toBe('VALIDATION');
  });
});
