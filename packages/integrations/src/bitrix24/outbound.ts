import { createHash } from 'node:crypto';
import type { PrismaClient } from '@giper/db';
import type { Bitrix24Client } from './client';

/**
 * Outbound (giper-pm → Bitrix24) writes.
 *
 * Conflict policy: each successful outbound write stamps `bitrixSyncedAt`
 * and `bitrixSyncedHash` on the Task. When an inbound webhook arrives we
 * compute the hash on the upstream payload — if it equals the stored hash
 * we treat it as the echo of our own write (skip). If it differs the
 * upstream changed independently and we flag `syncConflict=true`.
 *
 * What we push:
 *   - Task status (mapped local TaskStatus → Bitrix STATUS 1..7)
 *   - EXTERNAL comments (INTERNAL stay local-only)
 *
 * What we DON'T push:
 *   - Title / description (risk of overwriting client-facing wording)
 *   - Time entries (per product decision: time stays in giper-pm only)
 *   - Task creation / deletion (mirror is one-way for these)
 */

// Local TaskStatus → Bitrix24 STATUS code. Inverse of mapBitrixStatus.
// We collapse some local states (BACKLOG → 6 "deferred", BLOCKED → 6 too)
// because Bitrix doesn't have a direct equivalent and "deferred" is the
// least-bad fit; PM can override in Bitrix if needed.
const STATUS_TO_BITRIX: Record<string, string> = {
  TODO: '2',
  IN_PROGRESS: '3',
  REVIEW: '4',
  DONE: '5',
  BACKLOG: '6',
  BLOCKED: '6',
  CANCELED: '7',
};

/**
 * Push the local task's current status to Bitrix24. Idempotent: if the
 * remote already has the same status, Bitrix accepts the no-op.
 *
 * Stamps sync bookkeeping on the local row on success. Throws on Bitrix
 * errors so the caller can surface them; sync state is NOT updated on
 * failure (i.e. next attempt will retry).
 */
export async function pushTaskStatus(
  prisma: PrismaClient,
  client: Bitrix24Client,
  taskId: string,
): Promise<{ pushed: boolean }> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      status: true,
      externalId: true,
      externalSource: true,
    },
  });
  if (!task) throw new Error(`task ${taskId} not found`);
  if (task.externalSource !== 'bitrix24' || !task.externalId) {
    return { pushed: false };
  }

  const bitrixStatus = STATUS_TO_BITRIX[task.status];
  if (!bitrixStatus) {
    throw new Error(`no Bitrix mapping for status ${task.status}`);
  }

  await client.call('tasks.task.update', {
    taskId: task.externalId,
    fields: { STATUS: bitrixStatus },
  });

  // Hash what we synced — used by the inbound path to recognize echoes.
  const hash = hashTaskState({ status: task.status });
  await prisma.task.update({
    where: { id: task.id },
    data: {
      bitrixSyncedAt: new Date(),
      bitrixSyncedHash: hash,
      syncConflict: false,
    },
  });

  return { pushed: true };
}

/**
 * Push an EXTERNAL comment to Bitrix. Stores the returned comment id back
 * on the local row so future edits or the inbound dedupe path can match.
 */
export async function pushComment(
  prisma: PrismaClient,
  client: Bitrix24Client,
  commentId: string,
): Promise<{ pushed: boolean }> {
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: {
      id: true,
      body: true,
      visibility: true,
      externalId: true,
      task: {
        select: {
          externalId: true,
          externalSource: true,
        },
      },
      author: {
        select: { name: true, bitrixUserId: true },
      },
    },
  });
  if (!comment) throw new Error(`comment ${commentId} not found`);
  if (comment.visibility !== 'EXTERNAL') return { pushed: false };
  if (comment.task.externalSource !== 'bitrix24' || !comment.task.externalId) {
    return { pushed: false };
  }
  // Already synced — don't double-post on retries.
  if (comment.externalId) return { pushed: false };

  // Authorship is non-negotiable for outbound: Bitrix-side recipients
  // need to see who actually wrote the message (not the webhook owner).
  // Refuse the push if we don't have a bitrixUserId mapping yet — the
  // caller is expected to enrich the user first via the
  // /settings/users/[id] "Подтянуть из Bitrix" button.
  if (!comment.author.bitrixUserId) {
    throw new Error(
      `у автора ${comment.author.name ?? '(без имени)'} нет связи с Bitrix24 — ` +
        'подтяните данные на странице пользователя и повторите',
    );
  }

  // Translate our internal mention tokens (`@<userId>`) into Bitrix's
  // own [USER=<bxId>]Имя[/USER] BBCode so they render as live mention
  // pills in the Bitrix UI instead of literal cuids.
  const renderedBody = await renderMentionsForBitrix(prisma, comment.body);

  const params: Record<string, unknown> = {
    TASKID: comment.task.externalId,
    FIELDS: {
      POST_MESSAGE: renderedBody,
      AUTHOR_ID: comment.author.bitrixUserId,
    },
  };
  const res = await client.call<number | string>(
    'task.commentitem.add',
    params,
  );

  // The result is the new comment id (number).
  const remoteId = res.result != null ? String(res.result) : null;
  if (!remoteId) {
    throw new Error('Bitrix did not return a comment id');
  }

  await prisma.comment.update({
    where: { id: comment.id },
    data: {
      externalId: remoteId,
      externalSource: 'bitrix24',
    },
  });
  return { pushed: true };
}

/**
 * Stable hash of the synced task fields. We hash only what we actually
 * write/read across the boundary — title, description, etc. are out of
 * scope for sync, so they're not in the hash.
 */
export function hashTaskState(state: { status: string }): string {
  const normalized = JSON.stringify({ status: state.status });
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Replace every `@<localUserId>` mention token in a comment body with
 * `[USER=<bitrixUserId>]Имя Фамилия[/USER]` so Bitrix renders it as a
 * native mention chip. Tokens whose target user has no bitrixUserId
 * (yet) collapse to a plain "@Имя" — better than leaking the cuid.
 *
 * cuid format: starts with 'c', 24 chars total, lowercase alnum.
 */
async function renderMentionsForBitrix(
  prisma: PrismaClient,
  body: string,
): Promise<string> {
  const re = /@([a-z0-9]{24,})\b/g;
  const ids = Array.from(new Set(Array.from(body.matchAll(re), (m) => m[1] as string)));
  if (ids.length === 0) return body;
  const rows = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, bitrixUserId: true },
  });
  const byId = new Map(rows.map((u) => [u.id, u]));
  return body.replace(re, (match, id: string) => {
    const u = byId.get(id);
    if (!u) return match; // leave token untouched if we can't resolve
    if (u.bitrixUserId) {
      return `[USER=${u.bitrixUserId}]${u.name}[/USER]`;
    }
    return `@${u.name}`;
  });
}

/**
 * Push a local Project as a new Bitrix24 workgroup (sonet_group). Stamps
 * `externalSource='bitrix24'` and `externalId=<bxId>` back on the local
 * row so subsequent task pushes know which group to target. Idempotent:
 * if the project is already linked, returns without re-creating.
 */
export async function pushProjectAsWorkgroup(
  prisma: PrismaClient,
  client: Bitrix24Client,
  projectId: string,
): Promise<{ pushed: boolean; bitrixId?: string }> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      description: true,
      externalSource: true,
      externalId: true,
      ownerId: true,
      owner: { select: { bitrixUserId: true } },
    },
  });
  if (!project) throw new Error(`project ${projectId} not found`);
  if (project.externalSource === 'bitrix24' && project.externalId) {
    // Already mirrored — nothing to do.
    return { pushed: false, bitrixId: project.externalId };
  }
  if (project.externalSource && project.externalSource !== 'bitrix24') {
    throw new Error(
      `project is already linked to ${project.externalSource}; refuse to re-link`,
    );
  }

  // sonet_group.create wants UPPERCASE field keys. INITIATE_PERMS=A means
  // "anyone in the group can do anything" — closest to our giper-pm
  // membership model. VISIBLE='Y' / OPENED='N' = visible in the
  // company directory but invite-only joining.
  const owner = project.owner.bitrixUserId;
  const fields: Record<string, unknown> = {
    NAME: project.name.slice(0, 200),
    DESCRIPTION: (project.description ?? '').slice(0, 4000),
    VISIBLE: 'Y',
    OPENED: 'N',
    INITIATE_PERMS: 'A',
    ...(owner ? { OWNER_ID: owner } : {}),
  };
  const res = await client.call<number | string>('sonet_group.create', fields);
  const bxId = res.result != null ? String(res.result) : null;
  if (!bxId) {
    throw new Error('Bitrix did not return a workgroup id');
  }
  await prisma.project.update({
    where: { id: project.id },
    data: { externalSource: 'bitrix24', externalId: bxId },
  });
  return { pushed: true, bitrixId: bxId };
}

/**
 * Push a local Task as a new Bitrix24 task inside an already-mirrored
 * project. Required preconditions:
 *   - project.externalSource === 'bitrix24' && externalId set;
 *   - task is not yet mirrored.
 *
 * Maps assignee + creator via User.bitrixUserId where available; falls
 * back to the webhook owner (Bitrix accepts that). After the upstream
 * create succeeds, stamps `externalId/externalSource` on the local
 * task and primes `bitrixSyncedHash` so the inbound webhook (likely
 * to fire seconds later) doesn't read it as a conflict.
 */
export async function pushTaskAsBitrix(
  prisma: PrismaClient,
  client: Bitrix24Client,
  taskId: string,
): Promise<{ pushed: boolean; bitrixId?: string }> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      dueDate: true,
      externalSource: true,
      externalId: true,
      project: {
        select: {
          id: true,
          externalSource: true,
          externalId: true,
        },
      },
      assignee: { select: { bitrixUserId: true } },
      creator: { select: { bitrixUserId: true } },
    },
  });
  if (!task) throw new Error(`task ${taskId} not found`);
  if (task.externalSource === 'bitrix24' && task.externalId) {
    return { pushed: false, bitrixId: task.externalId };
  }
  if (task.externalSource && task.externalSource !== 'bitrix24') {
    throw new Error(
      `task is already linked to ${task.externalSource}; refuse to re-link`,
    );
  }
  if (task.project.externalSource !== 'bitrix24' || !task.project.externalId) {
    throw new Error(
      'parent project is not linked to Bitrix24 — publish the project first',
    );
  }

  const bitrixStatus = STATUS_TO_BITRIX[task.status];
  // Bitrix priority encoding: 0=low, 1=medium, 2=high. URGENT collapses to high.
  const priorityToBx: Record<string, string> = {
    LOW: '0',
    MEDIUM: '1',
    HIGH: '2',
    URGENT: '2',
  };

  const fields: Record<string, unknown> = {
    TITLE: task.title.slice(0, 250),
    DESCRIPTION: (task.description ?? '').slice(0, 32_000),
    GROUP_ID: task.project.externalId,
    STATUS: bitrixStatus ?? '2',
    PRIORITY: priorityToBx[task.priority] ?? '1',
    ...(task.assignee?.bitrixUserId
      ? { RESPONSIBLE_ID: task.assignee.bitrixUserId }
      : {}),
    ...(task.creator?.bitrixUserId
      ? { CREATED_BY: task.creator.bitrixUserId }
      : {}),
    ...(task.dueDate ? { DEADLINE: task.dueDate.toISOString() } : {}),
  };
  // tasks.task.add returns { task: { id, ... } }.
  const res = await client.call<{ task?: { id?: string | number } }>(
    'tasks.task.add',
    { fields },
  );
  const bxId = res.result?.task?.id != null ? String(res.result.task.id) : null;
  if (!bxId) {
    throw new Error('Bitrix did not return a task id');
  }

  const hash = hashTaskState({ status: task.status });
  await prisma.task.update({
    where: { id: task.id },
    data: {
      externalSource: 'bitrix24',
      externalId: bxId,
      bitrixSyncedAt: new Date(),
      bitrixSyncedHash: hash,
      syncConflict: false,
    },
  });
  return { pushed: true, bitrixId: bxId };
}
