import bcrypt from 'bcryptjs';
import { prisma } from '@giper/db';
import { generateTemporaryPassword } from '@giper/shared';
import { DomainError } from '../errors';
import type { SessionUser } from '../permissions';

/**
 * Admin-only: regenerate a temporary password for a user. Returns plaintext
 * once. Sets mustChangePassword=true so the user must rotate it on next login.
 */
export async function resetPassword(userId: string, actor: SessionUser) {
  if (actor.role !== 'ADMIN') {
    throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);
  }
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isActive: true },
  });
  if (!target) throw new DomainError('NOT_FOUND', 404);
  if (!target.isActive) {
    throw new DomainError('VALIDATION', 400, 'Пользователь деактивирован');
  }

  const tempPassword = generateTemporaryPassword(12);
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      mustChangePassword: true,
      // Don't update lastPasswordChangeAt — that's set when the *user* changes their password.
    },
  });

  return { tempPassword };
}
