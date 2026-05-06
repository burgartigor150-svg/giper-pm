import type { NextAuthConfig } from 'next-auth';

/**
 * Edge-safe NextAuth config for middleware. Does NOT include the Credentials
 * provider's `authorize` (Node-only — Prisma + bcrypt). Token validation works
 * because we use JWT sessions; the JWT carries id/role/mustChangePassword and
 * is verified on the edge with NEXTAUTH_SECRET.
 */
export const authEdgeConfig: NextAuthConfig = {
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
    error: '/login/error',
  },
  // Empty providers array — middleware only reads/verifies the existing JWT.
  providers: [],
};
