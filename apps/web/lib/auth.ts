import NextAuth, { type DefaultSession, type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma, type UserRole } from '@giper/db';
import { DomainError } from './errors';
import { verifyTelegramWebAppInitData } from './telegram/verifyWebAppInitData';

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
      id: 'telegram-webapp',
      name: 'Telegram Web App',
      credentials: {
        initData: { label: 'initData', type: 'text' },
      },
      async authorize(creds) {
        const initData = String(creds?.initData ?? '');
        const botToken = process.env.TG_BOT_TOKEN?.trim();
        if (!initData || !botToken) return null;

        const verified = verifyTelegramWebAppInitData(initData, botToken);
        if (!verified) return null;

        const user = await prisma.user.findUnique({
          where: { tgChatId: String(verified.telegramUserId), isActive: true },
          select: {
            id: true,
            email: true,
            name: true,
            image: true,
            role: true,
            mustChangePassword: true,
          },
        });
        if (!user) return null;

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
  ],
  callbacks: {
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
