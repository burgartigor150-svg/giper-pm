import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authEdgeConfig } from '@/lib/auth.edge';

const { auth } = NextAuth(authEdgeConfig);

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Public paths.
  //   /login, /api/auth     — actual login flow
  //   /                     — landing/redirect
  //   /api/cron/*           — gated by CRON_SECRET (Bearer) inside the route
  //   /api/webhooks/*       — gated by per-integration signature inside the
  //                           route (HMAC for GitHub, ?token= for Bitrix24)
  // Without these last two, middleware 302s the request before the route's
  // own auth runs — silently breaking host cron and inbound webhooks.
  const isPublic =
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/cron') ||
    pathname.startsWith('/api/webhooks') ||
    pathname.startsWith('/api/livekit/webhook') ||
    pathname === '/api/health' ||
    pathname === '/';

  if (!isPublic && !req.auth) {
    const loginUrl = new URL('/login', req.nextUrl);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return Response.redirect(loginUrl);
  }

  // Forward the current pathname so server layouts can read it via headers().
  const res = NextResponse.next();
  res.headers.set('x-pathname', pathname);
  return res;
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp)).*)'],
};
