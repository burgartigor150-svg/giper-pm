import type { PrismaClient } from '@giper/db';
import { KaitenClient } from './client';

const KAITEN_SOURCE = 'kaiten';

// Our stored mention token is `@<userId>` (cuid). Render it as `@Name` for Kaiten
// so a raw cuid never leaks into the card comment.
const MENTION_RE = /@([a-z0-9]{24,})/g;
async function renderMentionsForKaiten(prisma: PrismaClient, body: string): Promise<string> {
  const ids = [...body.matchAll(MENTION_RE)].map((m) => m[1]);
  if (ids.length === 0) return body;
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, name: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  return body.replace(MENTION_RE, (full, id: string) => {
    const name = nameById.get(id);
    return name ? `@${name}` : full;
  });
}

/**
 * Push a locally-authored EXTERNAL comment to its Kaiten card (giper-pm → Kaiten).
 *
 * Echo/loop guard: we only push comments that are NOT yet linked to an external
 * source (externalSource == null). Inbound-mirrored Kaiten comments already carry
 * externalSource='kaiten', so they're never re-posted. After a successful push we
 * stamp the comment with externalSource='kaiten' + externalId in the SAME scheme
 * the inbound sync uses (`${localTaskId}:${kaitenCommentId}`), so the next inbound
 * run recognises it as already-mirrored instead of creating a duplicate.
 *
 * The comment is authored in Kaiten by the API-key owner (we can't post as an
 * arbitrary user), so the giper-pm author's name is prefixed into the text.
 */
export async function pushKaitenComment(
  prisma: PrismaClient,
  client: KaitenClient,
  commentId: string,
): Promise<{ pushed: boolean }> {
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: {
      id: true,
      body: true,
      visibility: true,
      externalSource: true,
      taskId: true,
      task: { select: { externalId: true, externalSource: true } },
      author: { select: { name: true } },
    },
  });
  if (!comment) throw new Error(`comment ${commentId} not found`);
  if (comment.visibility !== 'EXTERNAL') return { pushed: false };
  if (comment.task.externalSource !== KAITEN_SOURCE || !comment.task.externalId) return { pushed: false };
  // Already linked to an external source → inbound mirror or our own echo. Skip.
  if (comment.externalSource) return { pushed: false };

  const cardId = Number(comment.task.externalId);
  if (!Number.isFinite(cardId)) return { pushed: false };

  // Escape markdown control chars in the author name (parity with inbound) and
  // translate @mention tokens so Kaiten readers see names, not internal cuids.
  const author = comment.author?.name?.trim().replace(/[*`_~[\]]/g, ' ').trim();
  const renderedBody = await renderMentionsForKaiten(prisma, comment.body);
  const text = author ? `**${author}:**\n\n${renderedBody}` : renderedBody;

  const created = await client.createCardComment(cardId, text);
  const remoteId = created?.id;
  if (remoteId == null) throw new Error('Kaiten did not return a comment id');

  await prisma.comment.update({
    where: { id: comment.id },
    data: { externalSource: KAITEN_SOURCE, externalId: `${comment.taskId}:${remoteId}` },
  });
  return { pushed: true };
}
