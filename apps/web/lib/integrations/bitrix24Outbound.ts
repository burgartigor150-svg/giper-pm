import { prisma } from '@giper/db';
import {
  pushTaskStatus,
  pushTaskDeadline,
  pushComment,
  pushProjectAsWorkgroup,
  pushTaskAsBitrix,
  enrichUserFromBitrix,
  type EnrichResult,
} from '@giper/integrations/bitrix24';
import { getBitrix24Client } from './bitrix24';

/**
 * Best-effort outbound wrappers used inside server actions.
 *
 * Why "best-effort": a Bitrix outage shouldn't block a user from changing
 * a task status in our own system. We log the error and continue. The
 * Task row keeps its old `bitrixSyncedAt`, so when the user (or the
 * inbound webhook) next touches it, we'll see that local > remote and
 * either retry or flag a conflict.
 *
 * Auth-gating: if BITRIX24_WEBHOOK_URL isn't configured, these are no-ops.
 * Means dev environments without the secret won't crash on every status
 * change.
 */

function tryClient() {
  if (!process.env.BITRIX24_WEBHOOK_URL?.trim()) return null;
  try {
    return getBitrix24Client();
  } catch {
    return null;
  }
}

export async function pushBitrixStatusBestEffort(taskId: string): Promise<void> {
  const client = tryClient();
  if (!client) return;
  try {
    await pushTaskStatus(prisma, client, taskId);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('bitrix24 outbound: pushTaskStatus failed', taskId, e);
  }
}

export async function pushBitrixDeadlineBestEffort(taskId: string): Promise<void> {
  const client = tryClient();
  if (!client) return;
  try {
    await pushTaskDeadline(prisma, client, taskId);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('bitrix24 outbound: pushTaskDeadline failed', taskId, e);
  }
}

export async function pushBitrixCommentBestEffort(commentId: string): Promise<void> {
  const client = tryClient();
  if (!client) return;
  try {
    await pushComment(prisma, client, commentId);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('bitrix24 outbound: pushComment failed', commentId, e);
  }
}

/**
 * Publish a giper-pm project as a Bitrix24 workgroup. Unlike the
 * status/comment best-effort wrappers, this one reports success/failure
 * back to the caller — publishing is an explicit user action and the
 * UI needs to know whether to congratulate or to flag the error.
 */
export async function publishProjectToBitrix(
  projectId: string,
): Promise<
  | { ok: true; bitrixId: string }
  | { ok: false; error: string }
> {
  const client = tryClient();
  if (!client) {
    return { ok: false, error: 'Bitrix24 не настроен (BITRIX24_WEBHOOK_URL пуст)' };
  }
  try {
    const res = await pushProjectAsWorkgroup(prisma, client, projectId);
    return { ok: true, bitrixId: res.bitrixId ?? '' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // eslint-disable-next-line no-console
    console.error('bitrix24 outbound: publish project failed', projectId, e);
    return { ok: false, error: msg };
  }
}

/**
 * Publish a giper-pm task as a new Bitrix24 task in the parent
 * workgroup. Returns success/error like publishProjectToBitrix.
 */
export async function publishTaskToBitrix(
  taskId: string,
): Promise<
  | { ok: true; bitrixId: string }
  | { ok: false; error: string }
> {
  const client = tryClient();
  if (!client) {
    return { ok: false, error: 'Bitrix24 не настроен' };
  }
  try {
    const res = await pushTaskAsBitrix(prisma, client, taskId);
    return { ok: true, bitrixId: res.bitrixId ?? '' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // eslint-disable-next-line no-console
    console.error('bitrix24 outbound: publish task failed', taskId, e);
    return { ok: false, error: msg };
  }
}

/**
 * Best-effort version of enrichUserFromBitrix — used inside the user-
 * create flow. Failures are logged, never thrown: a Bitrix outage
 * shouldn't block local user creation. The user can always retry via
 * the manual button on /settings/users/[id].
 */
export async function enrichUserFromBitrixBestEffort(
  userId: string,
): Promise<EnrichResult> {
  const client = tryClient();
  if (!client) {
    return { ok: false, error: 'Bitrix24 не настроен' };
  }
  try {
    return await enrichUserFromBitrix(prisma, client, userId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // eslint-disable-next-line no-console
    console.error('bitrix24 outbound: enrich user failed', userId, e);
    return { ok: false, error: msg };
  }
}
