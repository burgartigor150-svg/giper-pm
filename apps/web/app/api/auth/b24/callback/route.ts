import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { AuthError } from 'next-auth';
import { signIn } from '@/lib/auth';
import { baseUrl } from '@/lib/oauth/core';

/**
 * Bitrix24 OAuth callback. Verifies the CSRF state, then hands the one-time
 * `code` to the `bitrix24` Credentials provider via signIn — which exchanges it,
 * reads user.current, and gates to an existing active giper-pm user. On success
 * NextAuth sets the JWT session cookie and redirects to the stashed target; on
 * denial/failure we bounce to /login with an error flag.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code') ?? '';
  const state = url.searchParams.get('state') ?? '';

  const jar = await cookies();
  const expectedState = jar.get('b24_oauth_state')?.value;
  const callbackUrl = jar.get('b24_oauth_cb')?.value || '/dashboard';

  // Clear the one-time cookies regardless of outcome.
  const clear = (res: NextResponse) => {
    res.cookies.set('b24_oauth_state', '', { path: '/', maxAge: 0 });
    res.cookies.set('b24_oauth_cb', '', { path: '/', maxAge: 0 });
    return res;
  };

  if (!code || !state || !expectedState || state !== expectedState) {
    return clear(NextResponse.redirect(`${baseUrl()}/login?error=b24_state`, { status: 302 }));
  }

  const redirectUri = `${baseUrl()}/api/auth/b24/callback`;
  try {
    await signIn('bitrix24', { code, redirectUri, redirectTo: callbackUrl });
  } catch (e) {
    // signIn throws NEXT_REDIRECT on success — let Next handle that. An AuthError
    // means the exchange failed or the user isn't an allowed giper-pm account.
    if (e instanceof AuthError) {
      return clear(NextResponse.redirect(`${baseUrl()}/login?error=b24`, { status: 302 }));
    }
    throw e;
  }
  // Unreachable on success (signIn redirected), but satisfies the type checker.
  return clear(NextResponse.redirect(`${baseUrl()}${callbackUrl}`, { status: 302 }));
}
