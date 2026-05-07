'use server';

import { revalidatePath } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { DomainError } from '@/lib/errors';
import {
  runBitrix24SyncNow,
  runBitrix24TeamSyncNow,
} from '@/lib/integrations/bitrix24';

export type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

function toErr<T = unknown>(e: unknown): ActionResult<T> {
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

/**
 * Sync each member of the PM's roster from Bitrix24. Required because
 * the default sync runs in mine-only mode and only pulls the current
 * user's tasks — team members' tasks need their own scoped passes.
 *
 * PM/ADMIN-only. The action is long-running (one Bitrix sync per
 * member); we don't gate further since the page already requires
 * the role.
 */
export async function syncTeamFromBitrixAction(opts: {
  force?: boolean;
} = {}): Promise<
  | {
      ok: true;
      perMember: Array<{
        memberId: string;
        name: string;
        created: number;
        updated: number;
        comments: number;
      }>;
    }
  | { ok: false; error: { code: string; message: string } }
> {
  const me = await requireAuth();
  if (me.role !== 'ADMIN' && me.role !== 'PM') {
    return {
      ok: false,
      error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Только PM/ADMIN' },
    };
  }
  const res = await runBitrix24TeamSyncNow(me.id, { force: !!opts.force });
  if (!res.ok) {
    return {
      ok: false,
      error: { code: 'SYNC_FAILED', message: res.error },
    };
  }
  revalidatePath('/team');
  revalidatePath('/team/tasks');
  return { ok: true, perMember: res.perMember };
}
