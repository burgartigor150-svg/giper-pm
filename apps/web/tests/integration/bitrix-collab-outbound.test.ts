import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import { pushComment } from '@giper/integrations/bitrix24';
import type { Bitrix24Client } from '@giper/integrations/bitrix24';
import { makeUser, makeProject, makeTask } from './helpers/factories';

type Call = { method: string; params: Record<string, unknown> };

function fakeClient(result: number, sink: Call[]): Bitrix24Client {
  return {
    async call(method: string, params: Record<string, unknown>) {
      sink.push({ method, params });
      return { result };
    },
  } as unknown as Bitrix24Client;
}

async function bxTask(projectId: string, creatorId: string, over: { externalId: string; chatId?: string }) {
  const t = await makeTask({ projectId, creatorId });
  await prisma.task.update({
    where: { id: t.id },
    data: { externalSource: 'bitrix24', externalId: over.externalId, bitrixChatId: over.chatId ?? null },
  });
  return t;
}

async function extComment(taskId: string, authorId: string, body = 'из giper-pm') {
  return prisma.comment.create({
    data: { taskId, authorId, body, source: 'WEB', visibility: 'EXTERNAL', externalSource: null },
  });
}

describe('pushComment — collab task routes to the IM chat', () => {
  it('posts to im.message.add (chat dialog), prefixes author, stamps chat:<id> — no bitrixUserId needed', async () => {
    const owner = await makeUser({ name: 'Игорь' }); // note: NO bitrixUserId
    const project = await makeProject({ ownerId: owner.id });
    const task = await bxTask(project.id, owner.id, { externalId: 'T1', chatId: '777' });
    const c = await extComment(task.id, owner.id, 'привет коллаб');

    const calls: Call[] = [];
    const res = await pushComment(prisma, fakeClient(555, calls), c.id);
    expect(res.pushed).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('im.message.add');
    expect(calls[0].params.DIALOG_ID).toBe('chat777');
    expect(String(calls[0].params.MESSAGE)).toContain('Игорь');
    expect(String(calls[0].params.MESSAGE)).toContain('привет коллаб');

    const updated = await prisma.comment.findUniqueOrThrow({ where: { id: c.id } });
    expect(updated.externalSource).toBe('bitrix24');
    expect(updated.externalId).toBe('chat:555'); // matches inbound syncChat scheme → no dup
  });

  it('a non-collab task still uses task.commentitem.add (needs bitrixUserId)', async () => {
    const owner = await makeUser({ name: 'Без B24' }); // no bitrixUserId
    const project = await makeProject({ ownerId: owner.id });
    const task = await bxTask(project.id, owner.id, { externalId: 'T2' }); // no chatId
    const c = await extComment(task.id, owner.id);

    const calls: Call[] = [];
    // No bitrixUserId on the author → the legacy task-comment path refuses.
    await expect(pushComment(prisma, fakeClient(1, calls), c.id)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
