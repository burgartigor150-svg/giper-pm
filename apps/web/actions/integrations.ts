'use server';

import { revalidatePath } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { DomainError } from '@/lib/errors';
import { runBitrix24SyncNow } from '@/lib/integrations/bitrix24';

export type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

function toErr(e: unknown): ActionResult {
  if (e instanceof DomainError) {
    return { ok: false, error: { code: e.code, message: e.message } };
  }
  console.error('integration action error', e);
  return {
    ok: false,
    error: {
      code: 'INTERNAL',
      message: e instanceof Error ? e.message : 'Что-то пошло не так',
    },
  };
}

/**
 * Trigger a full Bitrix24 sync now. ADMIN-only — long-running, locks rate
 * limit, and writes to all three tables (User/Project/Task).
 */
export async function triggerBitrix24SyncAction(opts: {
  force?: boolean;
} = {}): Promise<ActionResult<{ created: number; updated: number; durationMs: number }>> {
  const me = await requireAuth();
  if (me.role !== 'ADMIN') {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Only admins' } };
  }
  try {
    const result = await runBitrix24SyncNow({ force: !!opts.force });
    revalidatePath('/settings/integrations/bitrix24');
    revalidatePath('/projects');
    return {
      ok: true,
      data: {
        created: result.projects.created + result.tasks.created,
        updated:
          result.users.updated + result.projects.updated + result.tasks.updated,
        durationMs: result.durationMs,
      },
    };
  } catch (e) {
    return toErr(e);
  }
}
