import NextAuth, { type DefaultSession, type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import bcrypt from 'bcryptjs';
import { prisma, type UserRole } from '@giper/db';
import { DomainError } from './errors';
import { resolveSsoUser } from './authProvisioning';
import { getEffectiveCaps } from './capabilities';
import type { CapabilityKey } from './capabilities';

declare module 'next-auth' {
  interface Session {
    user: DefaultSession['user'] & {
      id: string;
      role: UserRole;
      mustChangePassword: boolean;
    };
  }
  interface User {
    role?: UserRole;
    mustChangePassword?: boolean;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    role?: UserRole;
    mustChangePassword?: boolean;
  }
}

export const authConfig: NextAuthConfig = {
  // Credentials provider requires JWT sessions (database sessions are not supported).
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
    error: '/login/error',
  },
  providers: [
    Credentials({
      id: 'credentials',
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(creds) {
        const email = String(creds?.email ?? '').trim().toLowerCase();
        const password = String(creds?.password ?? '');
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true, email: true, name: true, image: true,
            role: true, isActive: true,
            passwordHash: true, mustChangePassword: true,
          },
        });
        if (!user || !user.isActive || !user.passwordHash) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
          mustChangePassword: user.mustChangePassword,
        };
      },
    }),
    // SSO (Google) — registered ONLY when its env vars are present. With them
    // unset the providers array is byte-identical to before, so shipping this
    // with no creds configured is a no-op. Setting an empty AUTH_GOOGLE_ID on
    // the server is also the instant rollback. NO non-null assertions (a `!`
    // on an absent var would throw at module load and 500 ALL auth).
    ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
      ? [
          Google({
            clientId: process.env.AUTH_GOOGLE_ID,
            clientSecret: process.env.AUTH_GOOGLE_SECRET,
          }),
        ]
      : []),
  ],
  callbacks: {
    // Allowlist gate for OAuth: a Google login is accepted ONLY if its
    // verified email matches an existing active user. We never auto-create
    // users, and the role always comes from our DB — Google can't elevate.
    async signIn({ user, account, profile }) {
      if (account?.provider !== 'google') return true; // credentials: vetted in authorize()
      const verified = (profile as { email_verified?: boolean } | undefined)?.email_verified === true;
      const resolved = await resolveSsoUser({ email: profile?.email ?? user?.email, emailVerified: verified });
      if (!resolved) return false;
      // Hydrate the user object from the DB so the jwt callback persists OUR
      // id/role, not Google's `sub`/profile.
      user.id = resolved.id;
      (user as { role?: UserRole }).role = resolved.role;
      (user as { mustChangePassword?: boolean }).mustChangePassword = false;
      return true;
    },
    async jwt({ token, user, trigger }) {
      // First sign-in: persist domain claims into the token.
      if (user) {
        token.id = user.id as string;
        token.role = (user as { role?: UserRole }).role ?? token.role;
        token.mustChangePassword = (user as { mustChangePassword?: boolean }).mustChangePassword ?? false;
      }
      // Refresh role/flag on explicit update() or every revalidation;
      // cheap because indexed PK lookup.
      if (trigger === 'update' && token.id) {
        const fresh = await prisma.user.findUnique({
          where: { id: token.id },
          select: { role: true, isActive: true, mustChangePassword: true },
        });
        if (!fresh || !fresh.isActive) {
          // Force sign-out by returning empty token.
          return {};
        }
        token.role = fresh.role;
        token.mustChangePassword = fresh.mustChangePassword;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.id) session.user.id = token.id;
      if (token.role) session.user.role = token.role;
      session.user.mustChangePassword = !!token.mustChangePassword;
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

/**
 * Throws DomainError('UNAUTHENTICATED') when there is no active session.
 * Use in Server Actions and Server Components.
 */
export async function requireAuth() {
  const session = await auth();
  if (!session?.user) {
    throw new DomainError('UNAUTHENTICATED', 401, 'Authentication required');
  }
  return session.user;
}

/**
 * Throws DomainError('INSUFFICIENT_PERMISSIONS', 403) when the current user
 * doesn't have one of the allowed roles.
 */
export async function requireRole(...allowed: UserRole[]) {
  const user = await requireAuth();
  if (!allowed.includes(user.role)) {
    throw new DomainError('INSUFFICIENT_PERMISSIONS', 403, 'Forbidden');
  }
  return user;
}

/**
 * Throws DomainError('INSUFFICIENT_PERMISSIONS', 403) when the current user's
 * effective capabilities (custom-role overlay resolved from the DB, falling
 * back to the UserRole baseline) don't include `cap`. The org-level companion
 * to requireRole — use it once call sites are wired to capabilities (slice 4).
 */
export async function requireCap(cap: CapabilityKey) {
  const user = await requireAuth();
  const caps = await getEffectiveCaps(user);
  if (!caps.has(cap)) {
    throw new DomainError('INSUFFICIENT_PERMISSIONS', 403, 'Forbidden');
  }
  return user;
}
