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
  //   /m/<token>            — guest meeting landing page. Auth is the
  //                           unguessable token in the URL; server-side
  //                           validation lives in joinMeetingAsGuestAction.
  //                           Without this entry the middleware bounces
  //                           the guest to /login before the page ever
  //                           renders.
  //   /sw.js, /manifest.*, /icons/*
  //                         — PWA / service worker assets. Browsers
  //                           sometimes fetch sw.js WITHOUT the session
  //                           cookie (background sync, no-cors fetch),
  //                           and Notification API needs sw to register
  //                           with a JS-typed response. A 302 to /login
  //                           returns HTML → register() throws
  //                           "MIME type 'text/html' is not supported"
  //                           and the whole push opt-in flow dies
  //                           silently (the "Включить" button just hangs).
  //   /api/push/vapid-public-key
  //                         — public VAPID pubkey. Reading it doesn't
  //                           expose anything we wouldn't print in the
  //                           service worker itself; gating it broke
  //                           guests' push flow + made the opt-in
  //                           banner non-functional for new tabs.
  // Without these, middleware 302s the request before the route's own
  // auth runs — silently breaking host cron, inbound webhooks, guest
  // call links, and the push-opt-in service-worker registration.
  const isPublic =
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/cron') ||
    pathname.startsWith('/api/webhooks') ||
    pathname.startsWith('/api/livekit/webhook') ||
    pathname.startsWith('/m/') ||
    pathname === '/sw.js' ||
    pathname.startsWith('/manifest.') ||
    pathname.startsWith('/icons/') ||
    pathname === '/api/push/vapid-public-key' ||
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
