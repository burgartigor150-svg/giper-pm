import { prisma } from '@giper/db';
import { getActiveFigmaToken, figmaFileComments } from './figmaApi';
import { getFigmaBotUserId } from './figmaBotUser';

/**
 * Mirror a Figma file's comments into every task that links that file. Comments
 * are deduped per (task, figma comment) via externalId `figma:<taskId>:<id>`,
 * authored by the synthetic Figma bot, INTERNAL visibility (design feedback).
 * Best-effort: no token / API error → 0 created, nothing thrown.
 */
export async function syncFigmaCommentsForFile(fileKey: string): Promise<{ created: number }> {
  const token = await getActiveFigmaToken();
  if (!token) return { created: 0 };

  const designs = await prisma.taskDesign.findMany({
    where: { fileKey },
    select: { taskId: true },
  });
  const taskIds = [...new Set(designs.map((d) => d.taskId))];
  if (taskIds.length === 0) return { created: 0 };

  let comments;
  try {
    comments = await figmaFileComments(fileKey, token);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('figma: file comments fetch failed', fileKey, e);
    return { created: 0 };
  }
  if (comments.length === 0) return { created: 0 };

  const botId = await getFigmaBotUserId();
  let created = 0;
  for (const taskId of taskIds) {
    for (const c of comments) {
      const externalId = `figma:${taskId}:${c.id}`;
      const exists = await prisma.comment.findUnique({
        where: { externalSource_externalId: { externalSource: 'figma', externalId } },
        select: { id: true },
      });
      if (exists) continue;
      const handle = c.user?.handle ?? 'кто-то';
      const msg = (c.message ?? '').slice(0, 2000);
      await prisma.comment.create({
        data: {
          taskId,
          authorId: botId,
          body: `[Figma] ${handle}: ${msg}`,
          source: 'WEB',
          visibility: 'INTERNAL',
          externalSource: 'figma',
          externalId,
        },
      });
      created++;
    }
  }
  return { created };
}

/** Sync comments for every Figma file linked to a task. */
export async function syncFigmaCommentsForTask(taskId: string): Promise<{ created: number }> {
  const designs = await prisma.taskDesign.findMany({
    where: { taskId },
    select: { fileKey: true },
  });
  const keys = [...new Set(designs.map((d) => d.fileKey))];
  let created = 0;
  for (const k of keys) created += (await syncFigmaCommentsForFile(k)).created;
  return { created };
}
