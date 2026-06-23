import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import { pushKaitenComment, type KaitenClient } from '@giper/integrations/kaiten';
import { makeUser, makeProject, makeTask } from './helpers/factories';

function fakeClient(onCreate: (cardId: number, text: string) => { id: number }): KaitenClient {
  return {
    async createCardComment(cardId: number, text: string) {
      const r = onCreate(cardId, text);
      return { id: r.id, text, author_id: null, created: '', updated: '' };
    },
  } as unknown as KaitenClient;
}

async function kaitenTask(projectId: string, creatorId: string, cardId: number) {
  const t = await makeTask({ projectId, creatorId });
  await prisma.task.update({ where: { id: t.id }, data: { externalSource: 'kaiten', externalId: String(cardId) } });
  return t;
}

async function comment(taskId: string, authorId: string, over: Partial<{ visibility: 'EXTERNAL' | 'INTERNAL'; externalSource: string | null; body: string }> = {}) {
  return prisma.comment.create({
    data: {
      taskId,
      authorId,
      body: over.body ?? 'из giper-pm',
      source: 'WEB',
      visibility: over.visibility ?? 'EXTERNAL',
      externalSource: over.externalSource ?? null,
    },
  });
}

describe('pushKaitenComment', () => {
  it('posts an EXTERNAL comment to the card and stamps the echo-guard externalId', async () => {
    const owner = await makeUser({ name: 'Игорь' });
    const project = await makeProject({ ownerId: owner.id });
    const task = await kaitenTask(project.id, owner.id, 4242);
    const c = await comment(task.id, owner.id, { body: 'привет из PM' });

    let postedText = '';
    const res = await pushKaitenComment(prisma, fakeClient((_id, text) => { postedText = text; return { id: 999 }; }), c.id);
    expect(res.pushed).toBe(true);
    expect(postedText).toContain('Игорь'); // author prefixed
    expect(postedText).toContain('привет из PM');

    const updated = await prisma.comment.findUniqueOrThrow({ where: { id: c.id } });
    expect(updated.externalSource).toBe('kaiten');
    expect(updated.externalId).toBe(`${task.id}:999`); // matches inbound scheme → no dup on re-import
  });

  it('renders @<userId> mention tokens as @Name (no raw cuid leaked to Kaiten)', async () => {
    const owner = await makeUser({ name: 'Автор' });
    const mentioned = await makeUser({ name: 'Пётр Иванов' });
    const project = await makeProject({ ownerId: owner.id });
    const task = await kaitenTask(project.id, owner.id, 4250);
    const c = await comment(task.id, owner.id, { body: `глянь @${mentioned.id} плиз` });

    let postedText = '';
    await pushKaitenComment(prisma, fakeClient((_id, text) => { postedText = text; return { id: 1 }; }), c.id);
    expect(postedText).toContain('@Пётр Иванов');
    expect(postedText).not.toContain(mentioned.id);
  });

  it('does not push INTERNAL comments, inbound mirrors, or non-Kaiten tasks', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const task = await kaitenTask(project.id, owner.id, 4243);
    let calls = 0;
    const client = fakeClient(() => { calls++; return { id: 1 }; });

    const internal = await comment(task.id, owner.id, { visibility: 'INTERNAL' });
    expect((await pushKaitenComment(prisma, client, internal.id)).pushed).toBe(false);

    const echo = await comment(task.id, owner.id, { externalSource: 'kaiten' }); // inbound mirror
    expect((await pushKaitenComment(prisma, client, echo.id)).pushed).toBe(false);

    // A Bitrix task's comment is not pushed to Kaiten.
    const bxTask = await makeTask({ projectId: project.id, creatorId: owner.id });
    await prisma.task.update({ where: { id: bxTask.id }, data: { externalSource: 'bitrix24', externalId: 'B1' } });
    const bxComment = await comment(bxTask.id, owner.id);
    expect((await pushKaitenComment(prisma, client, bxComment.id)).pushed).toBe(false);

    expect(calls).toBe(0);
  });
});
