import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import {
  syncTaskComments,
  getBitrixBotUserId,
  BITRIX_BOT_EMAIL,
  type Bitrix24Client,
  type SyncCommentsResult,
} from '@giper/integrations/bitrix24';
import { makeUser, makeProject, makeTask } from './helpers/factories';

/**
 * Regression: Bitrix-mirrored comments whose author can't be matched to a local
 * user (b24 robot, AUTHOR_ID '0', business processes, unsynced users) must be
 * attributed to the inert "Bitrix24" bot — NOT to the first admin (the old
 * fallback, which made every robot comment show up as a real person).
 */

type BxComment = { ID: string; AUTHOR_ID: string; POST_MESSAGE: string; POST_DATE: string };

function fakeClient(comments: BxComment[]): Bitrix24Client {
  return {
    async all<T>(): Promise<T[]> {
      return comments as unknown as T[];
    },
  } as unknown as Bitrix24Client;
}

const freshStats = (): SyncCommentsResult => ({
  totalSeen: 0, created: 0, updated: 0, deleted: 0, errors: 0,
});

describe('bitrix comment author attribution', () => {
  it('the bot user is inert (inactive, VIEWER) and idempotent', async () => {
    const a = await getBitrixBotUserId(prisma);
    const b = await getBitrixBotUserId(prisma);
    expect(a).toBe(b);
    const bot = await prisma.user.findUniqueOrThrow({ where: { email: BITRIX_BOT_EMAIL } });
    expect(bot.isActive).toBe(false);
    expect(bot.role).toBe('VIEWER');
    expect(bot.name).toBe('Bitrix24');
  });

  it('robot / unmatched author → bot; matched author → real user (never the admin)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const matched = await makeUser({ role: 'MEMBER' });
    await prisma.user.update({ where: { id: matched.id }, data: { bitrixUserId: 'bx-77' } });
    const p = await makeProject({ ownerId: admin.id, key: 'BXC' });
    const task = await makeTask({ projectId: p.id, creatorId: admin.id });

    await syncTaskComments(
      prisma,
      fakeClient([
        { ID: 'c1', AUTHOR_ID: '0', POST_MESSAGE: 'Робот изменил исполнителя', POST_DATE: '2026-02-03T11:24:27' },
        { ID: 'c2', AUTHOR_ID: 'bx-unsynced', POST_MESSAGE: 'от несинхронизированного юзера', POST_DATE: '2026-02-03T11:30:00' },
        { ID: 'c3', AUTHOR_ID: 'bx-77', POST_MESSAGE: 'обычный коммент', POST_DATE: '2026-02-03T12:00:00' },
      ]),
      { id: task.id, bitrixTaskId: '999' },
      freshStats(),
    );

    const botId = await getBitrixBotUserId(prisma);
    const get = (externalId: string) =>
      prisma.comment.findUniqueOrThrow({
        where: { externalSource_externalId: { externalSource: 'bitrix24', externalId } },
      });

    expect((await get('c1')).authorId).toBe(botId); // robot → bot
    expect((await get('c2')).authorId).toBe(botId); // unsynced → bot
    expect((await get('c3')).authorId).toBe(matched.id); // matched → real user
    // crucially, the admin is never the author of robot/unmatched comments
    expect((await get('c1')).authorId).not.toBe(admin.id);
    expect((await get('c2')).authorId).not.toBe(admin.id);
  });

  it('re-sync repairs a comment previously mis-attributed to the admin', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'BXC2' });
    const task = await makeTask({ projectId: p.id, creatorId: admin.id });
    // Simulate the OLD bug: a robot comment wrongly pinned on the admin.
    await prisma.comment.create({
      data: {
        taskId: task.id, authorId: admin.id, body: 'Робот сменил статус',
        source: 'WEB', visibility: 'EXTERNAL', externalSource: 'bitrix24', externalId: 'old1',
      },
    });

    await syncTaskComments(
      prisma,
      fakeClient([{ ID: 'old1', AUTHOR_ID: '0', POST_MESSAGE: 'Робот сменил статус', POST_DATE: '2026-02-03T11:24:27' }]),
      { id: task.id, bitrixTaskId: '999' },
      freshStats(),
    );

    const botId = await getBitrixBotUserId(prisma);
    const fixed = await prisma.comment.findUniqueOrThrow({
      where: { externalSource_externalId: { externalSource: 'bitrix24', externalId: 'old1' } },
    });
    expect(fixed.authorId).toBe(botId); // re-resolved away from the admin
  });
});
