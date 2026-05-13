import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import {
  syncOneTask,
  deleteOneTask,
  syncOneComment,
  updateOneComment,
  deleteOneComment,
} from '@giper/integrations/bitrix24';
import { getBitrix24Client } from '@/lib/integrations/bitrix24';

/**
 * Inbound webhook receiver for Bitrix24 outbound events. Configured in
 * Bitrix as `https://<our-host>/api/webhooks/bitrix24?token=<secret>` so
 * that ONTASKUPDATE / ONTASKCOMMENTADD fire here within seconds of the
 * change happening upstream.
 *
 * Auth: Bitrix outbound webhooks can't add custom HTTP headers, so the
 * shared secret rides in the URL query. We compare against
 * BITRIX24_INBOUND_SECRET — set it in `.env.local` and in the Bitrix
 * webhook config and they have to match.
 *
 * Payload shape (form-urlencoded, not JSON — Bitrix's choice):
 *   event=ONTASKUPDATE
 *   data[FIELDS_AFTER][ID]=12345
 *   auth[application_token]=...
 *
 * We stay loose with the parsing — Bitrix has multiple payload variants
 * across versions, so we just look for the task id in any of the known
 * places and bail on the rest.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: Request) {
  // 1. Auth.
  const url = new URL(req.url);
  const expected = process.env.BITRIX24_INBOUND_SECRET?.trim();
  if (!expected) {
    return NextResponse.json({ ok: false, error: 'not configured' }, { status: 503 });
  }
  if (url.searchParams.get('token') !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // 2. Parse the form-urlencoded body. Bitrix nests via square-bracket
  // keys (`data[FIELDS_AFTER][ID]`), which URLSearchParams decodes
  // verbatim — we walk the keys to extract what we need.
  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return NextResponse.json({ ok: false, error: 'no body' }, { status: 400 });
  }
  const params = new URLSearchParams(bodyText);
  const event = params.get('event') ?? '';

  // Bitrix sends form-urlencoded with bracket-keyed nesting. The same
  // `data[FIELDS_AFTER][ID]` key means different things depending on
  // event family:
  //   - ONTASK* (task lifecycle):    [ID] = task id
  //   - ONTASKCOMMENT* (discussion): [ID] = comment id, task id lives
  //                                  in [TASK_ID]
  // Dispatch by event prefix so we don't mis-parse comment events as
  // task events (which is exactly what dropped every fresh comment).
  const isCommentEvent = event.startsWith('ONTASKCOMMENT');
  const isTaskEvent = !isCommentEvent && event.startsWith('ONTASK');

  const taskId = isTaskEvent
    ? (params.get('data[FIELDS_AFTER][ID]') ??
       params.get('data[FIELDS_BEFORE][ID]') ??
       params.get('data[fields][ID]') ??
       null)
    : null;

  const commentId = isCommentEvent
    ? (params.get('data[FIELDS_AFTER][ID]') ??
       params.get('data[FIELDS_BEFORE][ID]') ??
       params.get('data[fields][ID]') ??
       params.get('data[ID]') ??
       null)
    : null;
  // Comment events carry the parent task id alongside the comment id.
  const taskForComment = isCommentEvent
    ? (params.get('data[FIELDS_AFTER][TASK_ID]') ??
       params.get('data[FIELDS_BEFORE][TASK_ID]') ??
       params.get('data[fields][TASK_ID]') ??
       params.get('data[TASK_ID]') ??
       null)
    : null;

  // Lightweight visibility: one structured line per inbound hit, no PII.
  // eslint-disable-next-line no-console
  console.log(
    `[bitrix:webhook] event=${event} taskId=${taskId ?? '-'} commentId=${commentId ?? '-'} taskForComment=${taskForComment ?? '-'}`,
  );
  // TEMP: dump the bracket-keyed `data[...]` keys for comment events so
  // we can locate the real comment id field (current parsing returns
  // commentId=0 — Bitrix likely stores it under a different bracket
  // path than FIELDS_AFTER/FIELDS_BEFORE/fields/ID).
  if (isCommentEvent) {
    const dataKeys: string[] = [];
    for (const key of params.keys()) {
      if (key.startsWith('data[')) {
        const v = params.get(key) ?? '';
        dataKeys.push(`${key}=${v.length > 60 ? v.slice(0, 60) + '…' : v}`);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[bitrix:webhook:dump] ${event} -> ${dataKeys.join(' | ')}`);
  }

  // 3. Dispatch by event.
  let client;
  try {
    client = getBitrix24Client();
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'client init failed' },
      { status: 500 },
    );
  }

  try {
    // ----- Task lifecycle -----
    if ((event === 'ONTASKUPDATE' || event === 'ONTASKADD') && taskId) {
      const result = await syncOneTask(prisma, client, taskId);
      if (result.taskId) {
        await revalidateTaskPath(result.taskId);
      }
      return NextResponse.json({ ok: true, event, ...result });
    }

    if (event === 'ONTASKDELETE' && taskId) {
      // Save project key before delete so we can revalidate the list
      // after the row is gone.
      const before = await prisma.task.findFirst({
        where: { externalSource: 'bitrix24', externalId: taskId },
        select: { project: { select: { key: true } } },
      });
      const result = await deleteOneTask(prisma, taskId);
      if (before) {
        revalidatePath(`/projects/${before.project.key}/list`);
        revalidatePath(`/projects/${before.project.key}/board`);
      }
      return NextResponse.json({ ok: true, event, ...result });
    }

    // ----- Comments -----
    if (event === 'ONTASKCOMMENTADD' && taskForComment && commentId) {
      const result = await syncOneComment(prisma, client, taskForComment, commentId);
      if (result.commentId) {
        const local = await prisma.comment.findUnique({
          where: { id: result.commentId },
          select: { taskId: true },
        });
        if (local) await revalidateTaskPath(local.taskId);
      }
      return NextResponse.json({ ok: true, event, ...result });
    }

    if (event === 'ONTASKCOMMENTUPDATE' && taskForComment && commentId) {
      const result = await updateOneComment(prisma, client, taskForComment, commentId);
      if (result.commentId) {
        const local = await prisma.comment.findUnique({
          where: { id: result.commentId },
          select: { taskId: true },
        });
        if (local) await revalidateTaskPath(local.taskId);
      }
      return NextResponse.json({ ok: true, event, ...result });
    }

    if (event === 'ONTASKCOMMENTDELETE' && commentId) {
      // Capture the parent task before delete so we can revalidate.
      const before = await prisma.comment.findUnique({
        where: {
          externalSource_externalId: {
            externalSource: 'bitrix24',
            externalId: commentId,
          },
        },
        select: { taskId: true },
      });
      const result = await deleteOneComment(prisma, commentId);
      if (before) await revalidateTaskPath(before.taskId);
      return NextResponse.json({ ok: true, event, ...result });
    }

    // Unknown event — ack so Bitrix doesn't retry.
    return NextResponse.json({ ok: true, event, action: 'ignored' });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('bitrix24 webhook error', event, e);
    return NextResponse.json(
      { ok: false, event, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

async function revalidateTaskPath(localTaskId: string) {
  const t = await prisma.task.findUnique({
    where: { id: localTaskId },
    select: {
      number: true,
      project: { select: { key: true } },
    },
  });
  if (!t) return;
  revalidatePath(`/projects/${t.project.key}/tasks/${t.number}`);
  revalidatePath(`/projects/${t.project.key}/list`);
}
