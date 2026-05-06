'use server';

import { signIn, signOut } from '@/lib/auth';

export async function signInWithGoogle(callbackUrl?: string) {
  await signIn('google', { redirectTo: callbackUrl ?? '/dashboard' });
}

export async function signInWithEmail(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) return;
  await signIn('resend', { email, redirectTo: '/dashboard' });
}

export async function signOutAction() {
  await signOut({ redirectTo: '/login' });
}
