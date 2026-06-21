import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import {
  backfillAdminAttributedComments,
  getBitrixBotUserId,
  type Bitrix24Client,
} from '@giper/integrations/bitrix24';
import { makeUser, makeProject, makeTask } from './helpers/factories';

/**
 * Targeted re-sync backfill (the case the DB migration can't reach: a comment
 * wrongly pinned on a Bitrix-LINKED admin). Re-syncing the task re-resolves the
 * live author (chat author_id '0' = robot → the Bitrix24 bot).
 */

function fakeClient(): Bitrix24Client {
  return {
    async call<T>(method: string): Promise<{ result?: T }> {
      if (method === 'im.dialog.messages.get') {
        return {
          result: {
            messages: [{ id: '1', author_id: '0', text: 'Робот установил крайний срок', date: '2026-06-19T15:23:53' }],
            users: {},
          } as unknown as T,
        };
      }
      if (method === 'tasks.task.history.list') return { result: { list: [] } as unknown as T };
      return { result: undefined };
    },
    async all<T>(): Promise<T[]> {
      return [] as unknown as T[];
    },
  } as unknown as Bitrix24Client;
}

describe('backfillAdminAttributedComments', () => {
  it('re-resolves an admin-pinned chat system comment to the bot; leaves unrelated tasks', async () => {
    const adminLinked = await makeUser({ role: 'ADMIN' });
    await prisma.user.update({ where: { id: adminLinked.id }, data: { bitrixUserId: 'bx-admin' } });
    const p = await makeProject({ ownerId: adminLinked.id, key: 'TBF' });

    // Affected task: a collab (chat) task with a robot chat message wrongly
    // pinned on the linked admin (externalId 'chat:1' so the re-sync matches it).
    const t = await makeTask({ projectId: p.id, creatorId: adminLinked.id });
    await prisma.task.update({
      where: { id: t.id },
      data: { externalSource: 'bitrix24', externalId: '999', bitrixChatId: 'c123' },
    });
    const wrong = await prisma.comment.create({
      data: {
        taskId: t.id, authorId: adminLinked.id, body: 'Робот установил крайний срок',
        source: 'WEB', visibility: 'EXTERNAL', externalSource: 'bitrix24', externalId: 'chat:1',
      },
    });

    // Control task: a bitrix task with NO admin-authored mirror comment → skipped.
    const other = await makeTask({ projectId: p.id, creatorId: adminLinked.id });
    await prisma.task.update({ where: { id: other.id }, data: { externalSource: 'bitrix24', externalId: '1000', bitrixChatId: 'c999' } });

    const res = await backfillAdminAttributedComments(prisma, fakeClient(), { limit: 50 });
    expect(res.done).toBe(true);
    expect(res.processed).toBe(1); // only the affected task

    const botId = await getBitrixBotUserId(prisma);
    expect((await prisma.comment.findUniqueOrThrow({ where: { id: wrong.id } })).authorId).toBe(botId);
    expect((await prisma.comment.findUniqueOrThrow({ where: { id: wrong.id } })).authorId).not.toBe(adminLinked.id);
    void other;
  });
});
