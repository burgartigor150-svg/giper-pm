import { describe, it, expect, vi, beforeEach } from 'vitest';

const { signOutMock, signInMock } = vi.hoisted(() => ({
  signOutMock: vi.fn(async (_opts?: { redirectTo?: string }) => {
    const e = new Error('NEXT_REDIRECT');
    (e as { digest?: string }).digest = 'NEXT_REDIRECT;/login';
    throw e;
  }),
  signInMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  signOut: signOutMock,
  signIn: signInMock,
}));

vi.mock('next-auth', () => ({
  AuthError: class AuthError extends Error {
    type: string;
    constructor(type: string) {
      super(type);
      this.type = type;
    }
  },
}));

import { signOutAction } from '@/actions/auth';

beforeEach(() => {
  signOutMock.mockClear();
  signInMock.mockClear();
});

describe('signOutAction', () => {
  it('calls signOut with redirectTo /login (throws NEXT_REDIRECT)', async () => {
    await expect(signOutAction()).rejects.toThrow('NEXT_REDIRECT');
    expect(signOutMock).toHaveBeenCalledWith({ redirectTo: '/login' });
  });

  it('signOut is invoked exactly once per call', async () => {
    await expect(signOutAction()).rejects.toThrow();
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });
});
