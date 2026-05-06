import NextAuth, { type DefaultSession, type NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';
import Resend from 'next-auth/providers/resend';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma, type UserRole } from '@giper/db';
import { DomainError } from './errors';

declare module 'next-auth' {
  interface Session {
    user: DefaultSession['user'] & {
      id: string;
      role: UserRole;
    };
  }
}

const providers: NextAuthConfig['providers'] = [
  Google({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    allowDangerousEmailAccountLinking: true,
  }),
];

if (process.env.RESEND_API_KEY) {
  providers.push(
    Resend({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.RESEND_FROM ?? 'no-reply@giper.fm',
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'database' },
  pages: {
    signIn: '/login',
    error: '/login/error',
    verifyRequest: '/login/verify-request',
  },
  providers,
  callbacks: {
    // allowSignUp: false — пускаем только тех, кто уже есть в БД.
    async signIn({ user }) {
      if (!user.email) return false;
      const existing = await prisma.user.findUnique({
        where: { email: user.email },
        select: { id: true, isActive: true },
      });
      if (!existing) return '/login/error?reason=not_allowed';
      if (!existing.isActive) return '/login/error?reason=disabled';
      return true;
    },
    async session({ session, user }) {
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { role: true },
      });
      session.user.id = user.id;
      session.user.role = dbUser?.role ?? ('MEMBER' as UserRole);
      return session;
    },
  },
});

/**
 * Throws DomainError('UNAUTHENTICATED') when there is no active session.
 * Use in Server Actions and Server Components. Returns the typed user.
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
