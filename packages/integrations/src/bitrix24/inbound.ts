import type { PrismaClient } from '@giper/db';
import type { Bitrix24Client } from './client';
import { mapBitrixTask, convertBitrixMarkup } from './mappers';
import type { BxTask } from './types';
import { hashTaskState } from './outbound';
import { ensureProjectForGroup } from './syncProjects';

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
    // Create on demand. Only possible when we have a synced workgroup
    // for the task — standalone Bitrix tasks (groupId=0) and tasks in
    // un-synced workgroups still get skipped, same as the bulk run.
    if (!mapped.bitrixGroupId) {
      return {
        action: 'skipped',
        reason: 'standalone Bitrix task (no workgroup) — not mirrored',
      };
    }
    let project = await prisma.project.findFirst({
      where: {
        externalSource: 'bitrix24',
        externalId: mapped.bitrixGroupId,
      },
      select: { id: true },
    });
    if (!project) {
      // Bulk syncProjects hasn't picked this workgroup up yet — pull it
      // in on demand so the task (and its comment) can land here.
      const projectId = await ensureProjectForGroup(
        prisma,
        client,
        mapped.bitrixGroupId,
      );
      if (!projectId) {
        return {
          action: 'skipped',
          reason: `workgroup ${mapped.bitrixGroupId} not found in Bitrix or has no resolvable owner`,
        };
      }
      project = { id: projectId };
    }
    const assigneeId = mapped.bitrixResponsibleId
      ? (
          await prisma.user.findFirst({
            where: { bitrixUserId: mapped.bitrixResponsibleId },
            select: { id: true },
          })
        )?.id ?? null
      : null;
    const upstreamCreatorId = mapped.bitrixCreatedById
      ? (
          await prisma.user.findFirst({
            where: { bitrixUserId: mapped.bitrixCreatedById },
            select: { id: true },
          })
        )?.id ?? null
      : null;
    const fallbackCreator = await prisma.user.findFirst({
      where: { role: 'ADMIN', isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const creatorId = upstreamCreatorId ?? fallbackCreator?.id ?? null;
    if (!creatorId) {
      return { action: 'skipped', reason: 'no creator resolution available' };
    }
    // Allocate next project-scoped task number.
    const max = await prisma.task.aggregate({
      where: { projectId: project.id },
      _max: { number: true },
    });
    const number = (max._max.number ?? 0) + 1;
    const incomingHashCreate = hashTaskState({ status: mapped.status });
    const created = await prisma.task.create({
      data: {
        projectId: project.id,
        number,
        title: mapped.title,
        description: mapped.description,
        status: mapped.status,
        priority: mapped.priority,
        dueDate: mapped.dueDate,
        startedAt: mapped.startedAt,
        completedAt: mapped.completedAt,
        creatorId,
        assigneeId,
        externalSource: 'bitrix24',
        externalId: mapped.externalId,
        tags: mapped.tags,
        bitrixCreatedById: mapped.bitrixCreatedById ?? null,
        bitrixResponsibleId: mapped.bitrixResponsibleId ?? null,
        bitrixSyncedAt: new Date(),
        bitrixSyncedHash: incomingHashCreate,
      },
      select: { id: true },
    });
    return { action: 'created', taskId: created.id };
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
 * Verification: Bitrix sends spurious ONTASKDELETE webhooks alongside
 * unrelated activity (e.g. after every ONTASKCOMMENTADD when the task's
 * audience visibility recomputes). To avoid nuking live tasks, we
 * confirm with `tasks.task.get` that the task is actually gone upstream
 * before deleting locally. Only Bitrix's "not found" response (404 /
 * NOT_FOUND code) is treated as a real delete; transient errors keep
 * the local mirror untouched.
 *
 * Side effects: cascade deletes wipe TimeEntry / Comment / Attachment /
 * TaskStatusChange / Checklist for this task. That's intentional: the
 * source-of-truth is Bitrix; if it's gone there, our local mirror has
 * no business keeping orphan history. If you need an audit trail, we
 * can swap to a `softDelete` field on Task in a follow-up.
 */
export async function deleteOneTask(
  prisma: PrismaClient,
  client: Bitrix24Client,
  bitrixTaskId: string,
): Promise<InboundResult> {
  const local = await prisma.task.findFirst({
    where: { externalSource: 'bitrix24', externalId: bitrixTaskId },
    select: { id: true },
  });
  if (!local) return { action: 'skipped', reason: 'task not mirrored locally' };

  // Verify upstream: only delete if Bitrix actually returns "not found".
  let upstreamGone = false;
  try {
    const res = await client.call<{ task: BxTask }>('tasks.task.get', {
      taskId: bitrixTaskId,
      select: ['ID'],
    });
    if (!res.result?.task) {
      upstreamGone = true;
    }
  } catch (e) {
    // Bitrix returns 400 with error code like NOT_FOUND / ACCESS_DENIED
    // for missing tasks. Treat NOT_FOUND as a real delete; anything
    // else (network, ACCESS_DENIED, rate-limit) → keep the row.
    const msg = e instanceof Error ? e.message : String(e);
    if (/not[_ ]found|tasks_task_not_found|404/i.test(msg)) {
      upstreamGone = true;
    } else {
      return {
        action: 'skipped',
        reason: `delete refused — verification failed: ${msg.slice(0, 120)}`,
      };
    }
  }

  if (!upstreamGone) {
    return {
      action: 'skipped',
      reason: 'task still alive upstream — ignoring spurious ONTASKDELETE',
    };
  }

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

  let task = await prisma.task.findFirst({
    where: { externalSource: 'bitrix24', externalId: bitrixTaskId },
    select: { id: true },
  });
  if (!task) {
    // Inbound comment for a task we haven't mirrored yet. The bulk
    // sync's incremental watermark only catches tasks whose CHANGED_DATE
    // moved — and Bitrix doesn't bump CHANGED_DATE on comment add. So
    // this is a frequent case during normal chatter on legacy tasks.
    // Try to pull the task in now; if it lands (right group, not closed
    // upstream), the comment can attach to it.
    const taskRes = await syncOneTask(prisma, client, bitrixTaskId);
    if (taskRes.taskId) {
      task = await prisma.task.findUnique({
        where: { id: taskRes.taskId },
        select: { id: true },
      });
    }
    if (!task) {
      return {
        action: 'skipped',
        reason: `task not mirrored locally and could not be pulled (${taskRes.action}${taskRes.reason ? ': ' + taskRes.reason : ''})`,
      };
    }
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
