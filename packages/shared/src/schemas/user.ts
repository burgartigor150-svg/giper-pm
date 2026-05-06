import { z } from 'zod';

export const userRoleSchema = z.enum(['ADMIN', 'PM', 'MEMBER', 'VIEWER']);
export type UserRoleInput = z.infer<typeof userRoleSchema>;

export const PASSWORD_MIN = 8;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Минимум ${PASSWORD_MIN} символов`)
  .max(128);

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email('Некорректный email'),
  name: z.string().trim().min(1, 'Укажите имя').max(80),
  role: userRoleSchema,
  timezone: z.string().trim().min(1).max(64).optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  role: userRoleSchema.optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const changeOwnPasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Введите текущий пароль'),
    newPassword: passwordSchema,
    confirmPassword: passwordSchema,
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Пароли не совпадают',
    path: ['confirmPassword'],
  });
export type ChangeOwnPasswordInput = z.infer<typeof changeOwnPasswordSchema>;

/** Generates a readable temporary password: 12 chars, mixed case + digits, no ambiguous chars. */
export function generateTemporaryPassword(length = 12): string {
  const alpha = 'abcdefghjkmnpqrstuvwxyz';
  const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const digits = '23456789';
  const all = alpha + ALPHA + digits;

  // Browser-safe: use Web Crypto if available, fall back to Math.random for non-browser tooling.
  const getRandom = (max: number): number => {
    const g = globalThis as unknown as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } };
    if (g.crypto?.getRandomValues) {
      const buf = new Uint32Array(1);
      g.crypto.getRandomValues(buf);
      return buf[0]! % max;
    }
    return Math.floor(Math.random() * max);
  };

  // Guarantee at least one of each class.
  const required = [
    alpha[getRandom(alpha.length)]!,
    ALPHA[getRandom(ALPHA.length)]!,
    digits[getRandom(digits.length)]!,
  ];
  const rest = Array.from({ length: length - required.length }, () => all[getRandom(all.length)]!);
  const chars = [...required, ...rest];
  // Fisher-Yates shuffle with crypto randomness.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = getRandom(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}
