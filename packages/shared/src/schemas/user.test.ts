import { describe, it, expect } from 'vitest';
import {
  createUserSchema,
  updateUserSchema,
  changeOwnPasswordSchema,
  userRoleSchema,
  passwordSchema,
  generateTemporaryPassword,
} from './user';

describe('userRoleSchema', () => {
  it('exposes 4 roles', () => {
    expect(userRoleSchema.options).toEqual(['ADMIN', 'PM', 'MEMBER', 'VIEWER']);
  });

  it('rejects unknown role', () => {
    expect(userRoleSchema.safeParse('GUEST').success).toBe(false);
  });
});

describe('passwordSchema', () => {
  it('accepts 8 chars', () => {
    expect(passwordSchema.parse('12345678')).toBe('12345678');
  });

  it('rejects 7 chars', () => {
    expect(passwordSchema.safeParse('1234567').success).toBe(false);
  });

  it('rejects 129 chars', () => {
    expect(passwordSchema.safeParse('a'.repeat(129)).success).toBe(false);
  });
});

describe('createUserSchema', () => {
  it('parses minimal valid input', () => {
    const r = createUserSchema.safeParse({ email: 'foo@bar.com', name: 'Foo', role: 'MEMBER' });
    expect(r.success).toBe(true);
  });

  it('lowercases and trims email', () => {
    const r = createUserSchema.parse({ email: '  FOO@BAR.COM  ', name: 'Foo', role: 'MEMBER' });
    expect(r.email).toBe('foo@bar.com');
  });

  it('rejects invalid email', () => {
    const r = createUserSchema.safeParse({ email: 'not-an-email', name: 'Foo', role: 'MEMBER' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toMatchObject({ email: expect.any(Array) });
  });

  it('rejects empty name', () => {
    const r = createUserSchema.safeParse({ email: 'a@b.com', name: '', role: 'MEMBER' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toMatchObject({ name: expect.any(Array) });
  });

  it('rejects whitespace-only name (after trim)', () => {
    const r = createUserSchema.safeParse({ email: 'a@b.com', name: '   ', role: 'MEMBER' });
    expect(r.success).toBe(false);
  });

  it('trims name', () => {
    const r = createUserSchema.parse({ email: 'a@b.com', name: '  Foo  ', role: 'MEMBER' });
    expect(r.name).toBe('Foo');
  });

  it('rejects name longer than 80', () => {
    const r = createUserSchema.safeParse({ email: 'a@b.com', name: 'x'.repeat(81), role: 'MEMBER' });
    expect(r.success).toBe(false);
  });

  it('rejects unknown role', () => {
    const r = createUserSchema.safeParse({ email: 'a@b.com', name: 'Foo', role: 'BOSS' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toMatchObject({ role: expect.any(Array) });
  });

  it('accepts optional timezone', () => {
    const r = createUserSchema.parse({ email: 'a@b.com', name: 'Foo', role: 'MEMBER', timezone: 'Europe/Moscow' });
    expect(r.timezone).toBe('Europe/Moscow');
  });

  it('rejects timezone longer than 64', () => {
    const r = createUserSchema.safeParse({ email: 'a@b.com', name: 'Foo', role: 'MEMBER', timezone: 'x'.repeat(65) });
    expect(r.success).toBe(false);
  });
});

describe('updateUserSchema', () => {
  it('accepts empty object', () => {
    expect(updateUserSchema.safeParse({}).success).toBe(true);
  });

  it('accepts partial updates', () => {
    expect(updateUserSchema.safeParse({ name: 'New' }).success).toBe(true);
    expect(updateUserSchema.safeParse({ role: 'ADMIN' }).success).toBe(true);
    expect(updateUserSchema.safeParse({ timezone: 'UTC' }).success).toBe(true);
  });

  it('rejects bad role', () => {
    const r = updateUserSchema.safeParse({ role: 'BOSS' });
    expect(r.success).toBe(false);
  });
});

describe('changeOwnPasswordSchema', () => {
  it('parses valid', () => {
    const r = changeOwnPasswordSchema.safeParse({
      currentPassword: 'old',
      newPassword: 'newpass123',
      confirmPassword: 'newpass123',
    });
    expect(r.success).toBe(true);
  });

  it('rejects mismatch with confirmPassword path', () => {
    const r = changeOwnPasswordSchema.safeParse({
      currentPassword: 'old',
      newPassword: 'newpass123',
      confirmPassword: 'different1',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors).toMatchObject({ confirmPassword: expect.any(Array) });
    }
  });

  it('rejects empty currentPassword', () => {
    const r = changeOwnPasswordSchema.safeParse({
      currentPassword: '',
      newPassword: 'newpass123',
      confirmPassword: 'newpass123',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors).toMatchObject({ currentPassword: expect.any(Array) });
    }
  });

  it('rejects newPassword shorter than 8', () => {
    const r = changeOwnPasswordSchema.safeParse({
      currentPassword: 'old',
      newPassword: 'short',
      confirmPassword: 'short',
    });
    expect(r.success).toBe(false);
  });
});

describe('generateTemporaryPassword', () => {
  it('produces default length 12', () => {
    expect(generateTemporaryPassword()).toHaveLength(12);
  });

  it('respects custom length', () => {
    expect(generateTemporaryPassword(20)).toHaveLength(20);
    expect(generateTemporaryPassword(16)).toHaveLength(16);
  });

  it('contains at least one lowercase, uppercase, and digit', () => {
    for (let i = 0; i < 50; i++) {
      const p = generateTemporaryPassword();
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[0-9]/);
    }
  });

  it('never includes ambiguous chars (0, O, 1, l, I, i, o) over 100 runs', () => {
    const ambiguous = /[0O1lIio]/;
    for (let i = 0; i < 100; i++) {
      const p = generateTemporaryPassword();
      expect(p).not.toMatch(ambiguous);
    }
  });

  it('generates different passwords each call', () => {
    const set = new Set<string>();
    for (let i = 0; i < 30; i++) set.add(generateTemporaryPassword());
    // extremely unlikely all 30 are equal
    expect(set.size).toBeGreaterThan(20);
  });
});
