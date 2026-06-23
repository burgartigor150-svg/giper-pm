import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import { syncCollabChat, type SyncCollabChatResult, type Bitrix24Client } from '@giper/integrations/bitrix24';
import { makeUser, makeProject } from './helpers/factories';

type Msg = { id: number; date: string; author_id: number | string; text: string };

/** Fake client: returns `pages` of messages on im.dialog.messages.get, then empty. */
function fakeClient(pages: Msg[][]): Bitrix24Client {
  let i = 0;
  return {
    async call(method: string) {
      if (method !== 'im.dialog.messages.get') return { result: {} };
      const page = pages[i] ?? [];
      i++;
      return { result: { messages: page } };
    },
  } as unknown as Bitrix24Client;
}

async function bxProject(ownerId: string, groupId: string) {
  const p = await makeProject({ ownerId });
  await prisma.project.update({ where: { id: p.id }, data: { externalSource: 'bitrix24', externalId: groupId } });
  return p;
}

describe('syncCollabChat', () => {
  it('creates a per-project channel, mirrors messages, maps authors, dedups system + re-runs', async () => {
    const owner = await makeUser({ name: 'Игорь' });
    await prisma.user.update({ where: { id: owner.id }, data: { bitrixUserId: '42' } });
    const project = await bxProject(owner.id, '456');

    const stats: SyncCollabChatResult = { messages: 0, created: 0, errors: 0, truncated: 0 };
    await syncCollabChat(
      prisma,
      fakeClient([
        [
          { id: 1001, date: '2026-06-01T10:00:00Z', author_id: 42, text: 'привет команда' },
          { id: 1002, date: '2026-06-01T10:01:00Z', author_id: 0, text: 'Зобков добавил сотрудника' }, // system
        ],
      ]),
      { id: project.id, externalId: project.externalId!, name: project.name },
      stats,
    );
    expect(stats.created).toBe(2);

    const channel = await prisma.channel.findUniqueOrThrow({
      where: { projectId_slug: { projectId: project.id, slug: 'bitrix-collab' } },
    });
    expect(channel.kind).toBe('PRIVATE'); // never org-wide

    // Members: the project owner + the mapped author are channel members.
    const members = (await prisma.channelMember.findMany({ where: { channelId: channel.id }, select: { userId: true } })).map((m) => m.userId);
    expect(members).toContain(owner.id);

    const msgs = await prisma.message.findMany({ where: { channelId: channel.id }, orderBy: { createdAt: 'asc' } });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].authorId).toBe(owner.id); // mapped by bitrixUserId
    expect(msgs[0].externalId).toBe('bxchat:1001');
    expect(msgs[1].source).toBe('SYSTEM'); // author 0
    expect(msgs[1].authorId).not.toBe(owner.id); // bot

    // Incremental re-run: high-water skips already-synced; only id 1003 is new.
    const stats2: SyncCollabChatResult = { messages: 0, created: 0, errors: 0, truncated: 0 };
    await syncCollabChat(
      prisma,
      fakeClient([
        [
          { id: 1003, date: '2026-06-01T10:02:00Z', author_id: 42, text: 'ещё одно' },
          { id: 1002, date: '2026-06-01T10:01:00Z', author_id: 0, text: 'старое' },
          { id: 1001, date: '2026-06-01T10:00:00Z', author_id: 42, text: 'привет команда' },
        ],
      ]),
      { id: project.id, externalId: project.externalId!, name: project.name },
      stats2,
    );
    expect(stats2.created).toBe(1); // only 1003
    expect(await prisma.message.count({ where: { channelId: channel.id } })).toBe(3);
  });

  it('two concurrent syncs do not duplicate or error (atomic upsert)', async () => {
    const owner = await makeUser();
    const project = await bxProject(owner.id, '789');
    const page = [{ id: 2001, date: '2026-06-01T10:00:00Z', author_id: 1, text: 'гонка' }];

    const s1: SyncCollabChatResult = { messages: 0, created: 0, errors: 0, truncated: 0 };
    const s2: SyncCollabChatResult = { messages: 0, created: 0, errors: 0, truncated: 0 };
    await Promise.all([
      syncCollabChat(prisma, fakeClient([page]), { id: project.id, externalId: project.externalId!, name: project.name }, s1),
      syncCollabChat(prisma, fakeClient([page]), { id: project.id, externalId: project.externalId!, name: project.name }, s2),
    ]);

    const channel = await prisma.channel.findUniqueOrThrow({
      where: { projectId_slug: { projectId: project.id, slug: 'bitrix-collab' } },
    });
    expect(await prisma.message.count({ where: { channelId: channel.id } })).toBe(1); // exactly one, no dup
    expect(s1.errors + s2.errors).toBe(0);
  });
});
