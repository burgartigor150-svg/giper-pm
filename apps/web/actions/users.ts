'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import {
  changeOwnPasswordSchema,
  createUserSchema,
  updateUserSchema,
} from '@giper/shared';
import { requireAuth, signOut } from '@/lib/auth';
import { DomainError } from '@/lib/errors';
import {
  changeOwnPassword,
  createUser,
  resetPassword,
  setUserActive,
  updateUser,
} from '@/lib/users';
import {
  enrichUserFromBitrixBestEffort,
  notifyBitrixPersonalBestEffort,
} from '@/lib/integrations/bitrix24Outbound';

export type UserSearchHit = {
  id: string;
  name: string;
  email: string;
  image: string | null;
};

export type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string; fieldErrors?: Record<string, string[]> } };

function toErr<T = unknown>(e: unknown): ActionResult<T> {
  if (e instanceof DomainError) {
    return { ok: false, error: { code: e.code, message: e.message } };
  }
  console.error('action error', e);
  return { ok: false, error: { code: 'INTERNAL', message: 'Что-то пошло не так' } };
}

function fromForm(formData: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  formData.forEach((v, k) => {
    obj[k] = v;
  });
  return obj;
}

// ----- Public-ish: search users (used in project member picker) -----------

export async function searchUsers(query: string): Promise<UserSearchHit[]> {
  await requireAuth();
  const q = query.trim();
  if (q.length < 2) return [];
  const rows = await prisma.user.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true, email: true, image: true },
    orderBy: { name: 'asc' },
    take: 8,
  });
  return rows;
}

// ----- Admin actions ------------------------------------------------------

export async function createUserAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string; tempPassword: string }>> {
  const me = await requireAuth();
  const parsed = createUserSchema.safeParse(fromForm(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION',
        message: 'Проверьте поля',
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    };
  }
  try {
    const { user, tempPassword } = await createUser(parsed.data, {
      id: me.id,
      role: me.role,
    });
    // Best-effort: pull bitrixUserId / name / image / timezone from
    // Bitrix24 in the same flow. Failures are silent — the user is
    // created either way, manual "Подтянуть из Bitrix" button on the
    // detail page is the retry path.
    await enrichUserFromBitrixBestEffort(user.id);
    revalidatePath('/settings/users');
    return { ok: true, data: { id: user.id, tempPassword } };
  } catch (e) {
    return toErr(e);
  }
}

/**
 * Manual "pull from Bitrix24" trigger on the user detail page. Same
 * code path as the create-time enrichment but synchronous — caller
 * sees the result and can decide whether to flash success or warn.
 */
export async function syncUserFromBitrixAction(
  userId: string,
): Promise<
  | { ok: true; matched: boolean; updatedFields: string[] }
  | { ok: false; error: { code: string; message: string } }
> {
  const me = await requireAuth();
  if (me.role !== 'ADMIN') {
    return {
      ok: false,
      error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Только ADMIN' },
    };
  }
  const res = await enrichUserFromBitrixBestEffort(userId);
  if (!res.ok) {
    return { ok: false, error: { code: 'PUBLISH_FAILED', message: res.error } };
  }
  revalidatePath(`/settings/users/${userId}`);
  revalidatePath('/settings/users');
  if (!res.matched) {
    return { ok: true, matched: false, updatedFields: [] };
  }
  return { ok: true, matched: true, updatedFields: res.updated };
}

export async function updateUserAction(
  userId: string,
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const me = await requireAuth();
  const parsed = updateUserSchema.safeParse(fromForm(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION',
        message: 'Проверьте поля',
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    };
  }
  try {
    await updateUser(userId, parsed.data, { id: me.id, role: me.role });
    revalidatePath('/settings/users');
    revalidatePath(`/settings/users/${userId}`);
    return { ok: true };
  } catch (e) {
    return toErr(e);
  }
}

export async function setUserActiveAction(
  userId: string,
  isActive: boolean,
): Promise<ActionResult> {
  const me = await requireAuth();
  try {
    const wasActiveBefore = (
      await prisma.user.findUnique({
        where: { id: userId },
        select: { isActive: true },
      })
    )?.isActive;
    await setUserActive(userId, isActive, { id: me.id, role: me.role });
    revalidatePath('/settings/users');
    revalidatePath(`/settings/users/${userId}`);

    // Welcome push: only on real activation (false → true transition),
    // best-effort so a Bitrix outage never rolls back the local flip.
    if (isActive && wasActiveBefore === false) {
      const target = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          name: true,
          role: true,
          bitrixUserId: true,
          positions: {
            select: { position: true, primary: true },
            orderBy: { primary: 'desc' },
          },
        },
      });
      if (target?.bitrixUserId) {
        const primary =
          target.positions.find((p) => p.primary) ?? target.positions[0];
        const base = process.env.PUBLIC_BASE_URL?.trim() || 'https://pm.since-b24-ru.ru';
        const lines = [
          `Привет, ${target.name}! Вам открыт доступ в giper-pm.`,
          `Роль: ${target.role}`,
          primary ? `Должность: ${primary.position}` : null,
          `Войти: ${base}`,
        ].filter(Boolean);
        await notifyBitrixPersonalBestEffort(
          target.bitrixUserId,
          lines.join('\n'),
        );
      }
    }

    return { ok: true };
  } catch (e) {
    return toErr(e);
  }
}

export async function resetPasswordAction(
  userId: string,
): Promise<ActionResult<{ tempPassword: string }>> {
  const me = await requireAuth();
  try {
    const { tempPassword } = await resetPassword(userId, { id: me.id, role: me.role });

    // Push the temp password to the user's Bitrix24 IM. Best-effort:
    // the admin still sees it in the modal regardless of whether the
    // Bitrix call succeeds.
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true, bitrixUserId: true },
    });
    if (target?.bitrixUserId) {
      const base =
        process.env.PUBLIC_BASE_URL?.trim() || 'https://pm.since-b24-ru.ru';
      const message = [
        `Привет, ${target.name}! Для giper-pm выдан новый временный пароль.`,
        `Логин: ${target.email}`,
        `Пароль: ${tempPassword}`,
        `Войти: ${base}`,
        'После входа система попросит сменить пароль.',
      ].join('\n');
      await notifyBitrixPersonalBestEffort(target.bitrixUserId, message);
    }

    return { ok: true, data: { tempPassword } };
  } catch (e) {
    return toErr(e);
  }
}

// ----- Self-service -------------------------------------------------------

export async function changeOwnPasswordAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const me = await requireAuth();
  const parsed = changeOwnPasswordSchema.safeParse(fromForm(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION',
        message: 'Проверьте поля',
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    };
  }
  try {
    await changeOwnPassword(parsed.data, { id: me.id, role: me.role });
  } catch (e) {
    return toErr(e);
  }
  // Rotate session: the JWT in the cookie still has the old mustChangePassword
  // flag and we don't refresh JWTs server-side. Forcing a fresh login is the
  // safest invalidation path and matches standard "rotate creds → re-auth" UX.
  await signOut({ redirectTo: '/login?changed=1' });
  // Unreachable — signOut throws NEXT_REDIRECT — but the type checker
  // wants a terminating statement on every path.
  return { ok: true };
}
