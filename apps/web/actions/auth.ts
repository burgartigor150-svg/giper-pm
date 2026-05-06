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

export async function signOutAction() {
  await signOut({ redirectTo: '/login' });
}
