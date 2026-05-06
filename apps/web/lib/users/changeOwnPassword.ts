import bcrypt from 'bcryptjs';
import { prisma } from '@giper/db';
import type { ChangeOwnPasswordInput } from '@giper/shared';
import { DomainError } from '../errors';
import type { SessionUser } from '../permissions';

/** Authenticated self-service password change. */
export async function changeOwnPassword(input: ChangeOwnPasswordInput, actor: SessionUser) {
  const me = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { passwordHash: true },
  });
  if (!me?.passwordHash) {
    throw new DomainError('VALIDATION', 400, 'Текущий пароль не задан');
  }

  const ok = await bcrypt.compare(input.currentPassword, me.passwordHash);
  if (!ok) {
    throw new DomainError('VALIDATION', 400, 'Неверный текущий пароль');
  }

  if (input.newPassword === input.currentPassword) {
    throw new DomainError('VALIDATION', 400, 'Новый пароль должен отличаться от текущего');
  }

  const passwordHash = await bcrypt.hash(input.newPassword, 10);
  await prisma.user.update({
    where: { id: actor.id },
    data: {
      passwordHash,
      mustChangePassword: false,
      lastPasswordChangeAt: new Date(),
    },
  });
}
