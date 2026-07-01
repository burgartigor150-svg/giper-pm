'use server';

import { AuthError } from 'next-auth';
import { signIn, signOut } from '@/lib/auth';

export type SignInResult =
  | { ok: true }
  | { ok: false; error: 'INVALID_CREDENTIALS' | 'INTERNAL' };

export async function signInWithCredentials(
  _prev: unknown,
  formData: FormData,
): Promise<SignInResult> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const callbackUrl = String(formData.get('callbackUrl') ?? '/dashboard');

  try {
    await signIn('credentials', { email, password, redirectTo: callbackUrl });
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) {
      // CredentialsSignin is what next-auth throws when authorize() returns null.
      if (e.type === 'CredentialsSignin') {
        return { ok: false, error: 'INVALID_CREDENTIALS' };
      }
    }
    // signIn() throws NEXT_REDIRECT on success — let Next handle it.
    throw e;
  }
}

/** True when Google SSO is configured on this deployment. */
export async function isSsoEnabled(): Promise<boolean> {
  return !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}

/** True when Bitrix24 SSO ("Войти через Битрикс24") is configured. */
export async function isBitrix24SsoEnabled(): Promise<boolean> {
  return !!(process.env.BITRIX24_OAUTH_CLIENT_ID && process.env.BITRIX24_OAUTH_CLIENT_SECRET);
}

/** Start the Google OAuth flow. Only works when SSO is configured. */
export async function signInWithGoogle(callbackUrl = '/dashboard'): Promise<void> {
  // signIn() throws NEXT_REDIRECT on success — let Next handle it.
  await signIn('google', { redirectTo: callbackUrl });
}
// Bitrix24 SSO is a redirect flow driven by /api/auth/b24/{login,callback}
// (Bitrix24 isn't RFC-OAuth), not a server action — the button links there.

export async function signOutAction() {
  await signOut({ redirectTo: '/login' });
}
