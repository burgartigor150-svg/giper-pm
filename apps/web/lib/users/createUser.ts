import bcrypt from 'bcryptjs';
import { prisma } from '@giper/db';
import { generateTemporaryPassword, type CreateUserInput } from '@giper/shared';
import { DomainError } from '../errors';
import { isUniqueConstraintError } from '../prisma-errors';
import type { SessionUser } from '../permissions';
import type { EffectiveCaps } from '../capabilities';

/**
 * Admin-only. Creates a user with a freshly generated temporary password.
 * Returns the plaintext password ONCE — caller must show it to the admin
 * and never persist it anywhere. `caps` (effective capabilities) overrides the
 * role check when supplied — pass it from the action layer.
 */
export async function createUser(input: CreateUserInput, actor: SessionUser, caps?: EffectiveCaps) {
  if (caps ? !caps.has('users.create') : actor.role !== 'ADMIN') {
    throw new DomainError('INSUFFICIENT_PERMISSIONS', 403);
  }
  const tempPassword = generateTemporaryPassword(12);
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  try {
    const user = await prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        role: input.role,
        timezone: input.timezone ?? 'Europe/Moscow',
        passwordHash,
        mustChangePassword: true,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    return { user, tempPassword };
  } catch (e) {
    if (isUniqueConstraintError(e)) {
      throw new DomainError('CONFLICT', 409, 'Пользователь с таким email уже существует');
    }
    throw e;
  }
}
