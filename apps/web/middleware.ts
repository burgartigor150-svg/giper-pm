import { NextResponse, type NextRequest } from 'next/server';

// In Auth.js v5 with `session.strategy: 'database'`, the middleware (edge runtime)
// can't verify the session against Prisma. So we do a coarse check here —
// "is there ANY auth.js session cookie?" — and rely on requireAuth() in Server
// Components for the strict check. This means a stale/invalid cookie will reach
// the Server Component, which will throw and redirect; that's intentional.

const SESSION_COOKIE_NAMES = ['authjs.session-token', '__Secure-authjs.session-token'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublic =
    pathname.startsWith('/login') || pathname.startsWith('/api/auth') || pathname === '/';
  if (isPublic) return NextResponse.next();

  const hasSession = SESSION_COOKIE_NAMES.some((name) => req.cookies.has(name));
  if (hasSession) return NextResponse.next();

  const loginUrl = new URL('/login', req.nextUrl);
  loginUrl.searchParams.set('callbackUrl', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp)).*)'],
};
