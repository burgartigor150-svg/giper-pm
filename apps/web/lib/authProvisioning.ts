import { prisma, type UserRole } from '@giper/db';

/**
 * SSO allowlist: resolve an OAuth login to an EXISTING active user, or null.
 *
 * We never auto-create users from an OAuth login — only emails that already
 * belong to an active, non-deleted user may sign in via SSO. The email must be
 * provider-verified. The role always comes from our DB, so an IdP can never
 * elevate a user. Email is matched case-insensitively (stored lowercase).
 */
export async function resolveSsoUser(opts: {
  email: string | null | undefined;
  emailVerified: boolean;
}): Promise<{ id: string; role: UserRole } | null> {
  const email = String(opts.email ?? '').trim().toLowerCase();
  if (!email || !opts.emailVerified) return null;
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, isActive: true, deletedAt: true },
  });
  if (!user || !user.isActive || user.deletedAt) return null;
  return { id: user.id, role: user.role };
}
