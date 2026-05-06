import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authEdgeConfig } from '@/lib/auth.edge';

const { auth } = NextAuth(authEdgeConfig);

export default auth((req) => {
  const { pathname } = req.nextUrl;

  const isPublic =
    pathname.startsWith('/login') || pathname.startsWith('/api/auth') || pathname === '/';

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
