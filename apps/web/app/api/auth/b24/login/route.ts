import { NextResponse } from 'next/server';
import { b24AuthorizeUrl, isBitrix24OauthConfigured } from '@/lib/b24Oauth';
import { baseUrl } from '@/lib/oauth/core';

/**
 * Kicks off "Войти через Битрикс24": mint a CSRF state, stash it (+ the
 * post-login target) in short-lived cookies, and redirect to the Bitrix24
 * authorize screen. The public origin (baseUrl) is used for the redirect_uri so
 * it matches exactly what's whitelisted in the Bitrix24 OAuth application.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!isBitrix24OauthConfigured()) {
    return new NextResponse('Bitrix24 OAuth не настроен на этом сервере.', { status: 503 });
  }
  const url = new URL(req.url);
  const callbackUrl = url.searchParams.get('callbackUrl') || '/dashboard';
  const state = crypto.randomUUID();
  const redirectUri = `${baseUrl()}/api/auth/b24/callback`;

  const res = NextResponse.redirect(b24AuthorizeUrl(state, redirectUri), { status: 302 });
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 600,
    path: '/',
  };
  res.cookies.set('b24_oauth_state', state, cookieOpts);
  // Only keep same-origin relative paths as the post-login target (open-redirect guard).
  res.cookies.set('b24_oauth_cb', callbackUrl.startsWith('/') ? callbackUrl : '/dashboard', cookieOpts);
  return res;
}
