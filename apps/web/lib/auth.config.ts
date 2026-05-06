import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';

/**
 * Edge-safe Auth.js config (no Prisma, no Node-only imports).
 * Used by middleware.ts. The full config with adapter + callbacks lives in lib/auth.ts.
 */
export const authConfig: NextAuthConfig = {
  pages: {
    signIn: '/login',
    error: '/login/error',
    verifyRequest: '/login/verify-request',
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = request.nextUrl;

      // Public routes
      if (pathname.startsWith('/login') || pathname.startsWith('/api/auth')) {
        return true;
      }
      // Everything else requires auth
      return isLoggedIn;
    },
  },
};
