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

/** True when SSO (Google) is configured on this deployment. */
export async function isSsoEnabled(): Promise<boolean> {
  return !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}

/** Start the Google OAuth flow. Only works when SSO is configured. */
export async function signInWithGoogle(callbackUrl = '/dashboard'): Promise<void> {
  // signIn() throws NEXT_REDIRECT on success — let Next handle it.
  await signIn('google', { redirectTo: callbackUrl });
}

export async function signOutAction() {
  await signOut({ redirectTo: '/login' });
}
