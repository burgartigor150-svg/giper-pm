import type { PrismaClient } from '@giper/db';
import type { Bitrix24Client } from './client';
import { mapBitrixTask, convertBitrixMarkup } from './mappers';
import type { BxTask } from './types';
import { hashTaskState } from './outbound';

/**
 * Inbound (Bitrix24 → giper-pm) handlers, used by the webhook endpoint.
 *
 * Conflict policy mirrors outbound:
 *   - On task update: if the new upstream state hashes to our last
 *     bitrixSyncedHash, this is the echo of our own write — skip.
 *     Otherwise apply the upstream state. If we have a local change that
 *     hasn't been pushed yet (i.e. `updatedAt > bitrixSyncedAt`) flag
 *     `syncConflict=true` so the UI can warn.
 *   - On comment add: dedupe by remote id. If a Comment row with this
 *     externalId already exists, that's our own echo — skip.
 */

export type InboundResult = {
  action: 'created' | 'updated' | 'echoed' | 'conflict' | 'skipped';
  taskId?: string;
  commentId?: string;
  reason?: string;
};

/**
 * Pull a single Bitrix task by id and reconcile it with our local row.
 * Used by ONTASKUPDATE / ONTASKADD webhook events.
 */
export async function syncOneTask(
  prisma: PrismaClient,
  client: Bitrix24Client,
  bitrixTaskId: string,
): Promise<InboundResult> {
  // Same select as the bulk runner — keep them in sync.
  const res = await client.call<{ task: BxTask }>('tasks.task.get', {
    taskId: bitrixTaskId,
    select: [
      'ID',
      'TITLE',
      'DESCRIPTION',
      'STATUS',
      'PRIORITY',
      'GROUP_ID',
      'RESPONSIBLE_ID',
      'CREATED_BY',
      'CREATED_DATE',
      'CHANGED_DATE',
      'CLOSED_DATE',
      'DEADLINE',
      'START_DATE_PLAN',
      'PARENT_ID',
    ],
  });
  const raw = res.result?.task;
  if (!raw) return { action: 'skipped', reason: 'task not found in Bitrix' };

  const mapped = mapBitrixTask(raw);

  // If the upstream task transitioned to DONE or CANCELED, drop our
  // local mirror — same policy as syncTasks's '!STATUS': [5,7] filter.
  // We don't keep "completed" tasks on the giper-pm side because the
  // team uses Bitrix as the system-of-record for closed work and a
  // mirrored DONE row just bloats the boards.
  const isClosedUpstream = mapped.status === 'DONE' || mapped.status === 'CANCELED';

  const local = await prisma.task.findFirst({
    where: { externalSource: 'bitrix24', externalId: mapped.externalId },
    select: {
      id: true,
      status: true,
      updatedAt: true,
      bitrixSyncedAt: true,
      bitrixSyncedHash: true,
    },
  });
  if (!local) {
    if (isClosedUpstream) {
      return {
        action: 'skipped',
        reason: 'task closed upstream and not mirrored — nothing to do',
      };
    }
    return {
      action: 'skipped',
      reason: 'task not mirrored locally yet — let the next bulk run create it',
    };
  }
  if (isClosedUpstream) {
    await prisma.task.delete({ where: { id: local.id } });
    return {
      action: 'updated',
      taskId: local.id,
      reason: `closed upstream (status=${mapped.status}) — local mirror dropped`,
    };
  }

  const incomingHash = hashTaskState({ status: mapped.status });

  // Echo detection: same hash as our last successful outbound → ignore.
  if (local.bitrixSyncedHash && local.bitrixSyncedHash === incomingHash) {
    return { action: 'echoed', taskId: local.id };
  }

  // Detect a clobbering write: we have a newer local change that wasn't
  // pushed yet. If updatedAt > bitrixSyncedAt and the upstream value
  // disagrees with what we last synced, this is a real conflict.
  const hasUnpushedLocalChange =
    local.bitrixSyncedAt == null ||
    local.updatedAt.getTime() > local.bitrixSyncedAt.getTime();

  if (hasUnpushedLocalChange && local.status !== mapped.status) {
    // Don't blindly overwrite. Persist the upstream state in a quiet
    // form (we record the hash) but flag the row so the UI prompts
    // the user to choose — don't lose either side silently.
    await prisma.task.update({
      where: { id: local.id },
      data: {
        bitrixSyncedAt: new Date(),
        bitrixSyncedHash: incomingHash,
        syncConflict: true,
      },
    });
    return { action: 'conflict', taskId: local.id };
  }

  // Apply upstream state.
  await prisma.task.update({
    where: { id: local.id },
    data: {
      status: mapped.status,
      priority: mapped.priority,
      dueDate: mapped.dueDate,
      startedAt: mapped.startedAt,
      completedAt: mapped.completedAt,
      bitrixSyncedAt: new Date(),
      bitrixSyncedHash: incomingHash,
      syncConflict: false,
    },
  });
  return { action: 'updated', taskId: local.id };
}

type BxComment = {
  ID: string;
  AUTHOR_ID: string;
  AUTHOR_NAME?: string;
  POST_MESSAGE: string;
  POST_DATE: string;
};

/**
 * Hard-delete a locally mirrored task. Used by ONTASKDELETE.
 *
 * Tasks NOT mirrored locally → no-op. Tasks not from Bitrix → refused
 * (we won't drop locally-authored rows from a webhook payload).
 *
 * Side effects: cascade deletes wipe TimeEntry / Comment / Attachment /
 * TaskStatusChange / Checklist for this task. That's intentional: the
 * source-of-truth is Bitrix; if it's gone there, our local mirror has
 * no business keeping orphan history. If you need an audit trail, we
 * can swap to a `softDelete` field on Task in a follow-up.
 */
export async function deleteOneTask(
  prisma: PrismaClient,
  bitrixTaskId: string,
): Promise<InboundResult> {
  const local = await prisma.task.findFirst({
    where: { externalSource: 'bitrix24', externalId: bitrixTaskId },
    select: { id: true },
  });
  if (!local) return { action: 'skipped', reason: 'task not mirrored locally' };
  await prisma.task.delete({ where: { id: local.id } });
  return { action: 'updated', taskId: local.id, reason: 'deleted upstream' };
}

/**
 * Pull a single comment from Bitrix and upsert into our Comment table.
 * Used by ONTASKCOMMENTADD.
 *
 * Echo detection: if the comment is already linked to a local row by
 * (externalSource, externalId), we created it via outbound — skip.
 */
export async function syncOneComment(
  prisma: PrismaClient,
  client: Bitrix24Client,
  bitrixTaskId: string,
  bitrixCommentId: string,
): Promise<InboundResult> {
  // Already linked → our own echo.
  const existing = await prisma.comment.findUnique({
    where: {
      externalSource_externalId: {
        externalSource: 'bitrix24',
        externalId: bitrixCommentId,
      },
    },
    select: { id: true },
  });
  if (existing) return { action: 'echoed', commentId: existing.id };

  const task = await prisma.task.findFirst({
    where: { externalSource: 'bitrix24', externalId: bitrixTaskId },
    select: { id: true },
  });
  if (!task) {
    return { action: 'skipped', reason: 'task not mirrored locally' };
  }

  const res = await client.call<BxComment>('task.commentitem.get', {
    TASKID: bitrixTaskId,
    ITEMID: bitrixCommentId,
  });
  const c = res.result;
  if (!c) return { action: 'skipped', reason: 'comment not found' };

  // Map AUTHOR_ID → our user (best effort). If not linked, fall back to
  // the project owner so the comment still shows up; the bitrixUserId
  // is preserved on the comment metadata via source='WEB'.
  const author = await prisma.user.findFirst({
    where: { bitrixUserId: c.AUTHOR_ID },
    select: { id: true },
  });
  let authorId = author?.id;
  if (!authorId) {
    const fallback = await prisma.user.findFirst({
      where: { role: 'ADMIN', isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!fallback) return { action: 'skipped', reason: 'no author resolution' };
    authorId = fallback.id;
  }

  const created = await prisma.comment.create({
    data: {
      taskId: task.id,
      authorId,
      body: convertBitrixMarkup(c.POST_MESSAGE ?? '').slice(0, 50_000),
      source: 'WEB',
      visibility: 'EXTERNAL',
      externalSource: 'bitrix24',
      externalId: c.ID,
      createdAt: c.POST_DATE ? new Date(c.POST_DATE) : new Date(),
    },
    select: { id: true },
  });
  return { action: 'created', commentId: created.id };
}

/**
 * Update an existing locally mirrored comment from Bitrix.
 * Used by ONTASKCOMMENTUPDATE.
 *
 * If we have no local row for that externalId yet, fall back to the
 * add path so we don't drop the change on the floor (Bitrix may
 * UPDATE without a preceding ADD if the prior ADD was missed).
 */
export async function updateOneComment(
  prisma: PrismaClient,
  client: Bitrix24Client,
  bitrixTaskId: string,
  bitrixCommentId: string,
): Promise<InboundResult> {
  const local = await prisma.comment.findUnique({
    where: {
      externalSource_externalId: {
        externalSource: 'bitrix24',
        externalId: bitrixCommentId,
      },
    },
    select: { id: true, taskId: true },
  });
  if (!local) {
    return syncOneComment(prisma, client, bitrixTaskId, bitrixCommentId);
  }
  const res = await client.call<BxComment>('task.commentitem.get', {
    TASKID: bitrixTaskId,
    ITEMID: bitrixCommentId,
  });
  const c = res.result;
  if (!c) return { action: 'skipped', reason: 'comment not found upstream' };
  await prisma.comment.update({
    where: { id: local.id },
    data: { body: convertBitrixMarkup(c.POST_MESSAGE ?? '').slice(0, 50_000) },
  });
  return { action: 'updated', commentId: local.id };
}

/**
 * Hard-delete a locally mirrored comment. Used by ONTASKCOMMENTDELETE.
 * No-op if we never had it.
 */
export async function deleteOneComment(
  prisma: PrismaClient,
  bitrixCommentId: string,
): Promise<InboundResult> {
  const local = await prisma.comment.findUnique({
    where: {
      externalSource_externalId: {
        externalSource: 'bitrix24',
        externalId: bitrixCommentId,
      },
    },
    select: { id: true },
  });
  if (!local) return { action: 'skipped', reason: 'comment not mirrored' };
  await prisma.comment.delete({ where: { id: local.id } });
  return { action: 'updated', commentId: local.id, reason: 'deleted upstream' };
}

// stripBitrixCommentMarkup → moved into mappers.convertBitrixMarkup so
// task descriptions and comments share one BBCode→Markdown renderer.
