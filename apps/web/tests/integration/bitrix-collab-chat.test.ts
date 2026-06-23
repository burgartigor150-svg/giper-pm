import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import {
  syncCollabChat,
  pushCollabChatMessage,
  type SyncCollabChatResult,
  type Bitrix24Client,
} from '@giper/integrations/bitrix24';
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

/** Fake client that records every call and returns `id` from im.message.add. */
function captureClient(returnId: number) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = {
    async call(method: string, params: Record<string, unknown>) {
      calls.push({ method, params });
      if (method === 'im.message.add') return { result: returnId };
      return { result: {} };
    },
  } as unknown as Bitrix24Client;
  return { client, calls };
}

async function bxProject(ownerId: string, groupId: string) {
  const p = await makeProject({ ownerId });
  return prisma.project.update({
    where: { id: p.id },
    data: { externalSource: 'bitrix24', externalId: groupId },
  });
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

  it('does NOT create a channel when the collab chat is inaccessible (403)', async () => {
    const owner = await makeUser();
    const project = await bxProject(owner.id, '999');
    const throwing = {
      async call() {
        throw new Error('bitrix24 im.dialog.messages.get failed: 403 ACCESS_ERROR');
      },
    } as unknown as Bitrix24Client;

    const stats: SyncCollabChatResult = { messages: 0, created: 0, errors: 0, truncated: 0 };
    await syncCollabChat(prisma, throwing, { id: project.id, externalId: project.externalId!, name: project.name }, stats);

    expect(stats.errors).toBe(1);
    // No empty orphan channel left behind for a collab we can't read.
    const ch = await prisma.channel.findUnique({
      where: { projectId_slug: { projectId: project.id, slug: 'bitrix-collab' } },
    });
    expect(ch).toBeNull();
  });
});

describe('pushCollabChatMessage (outbound)', () => {
  /** A bitrix24 project with its mirrored collab channel and a single member. */
  async function collabSetup(groupId: string) {
    const author = await makeUser({ name: 'Игорь' });
    const project = await bxProject(author.id, groupId);
    const channel = await prisma.channel.create({
      data: {
        kind: 'PRIVATE',
        slug: 'bitrix-collab',
        name: 'Чат коллаба (Bitrix24)',
        projectId: project.id,
        createdById: author.id,
      },
    });
    return { author, project, channel };
  }

  it('pushes a giper-pm message into the collab chat and stamps it for dedup', async () => {
    const { author, channel } = await collabSetup('456');
    const msg = await prisma.message.create({
      data: { channelId: channel.id, authorId: author.id, body: 'привет из pm' },
    });

    const { client, calls } = captureClient(9001);
    const r = await pushCollabChatMessage(prisma, client, msg.id);
    expect(r.pushed).toBe(true);

    const add = calls.find((c) => c.method === 'im.message.add');
    expect(add?.params.DIALOG_ID).toBe('sg456'); // collab group dialog
    expect(String(add?.params.MESSAGE)).toContain('Игорь:'); // author name prefixed
    expect(String(add?.params.MESSAGE)).toContain('привет из pm');

    // Stamped in the same scheme syncCollabChat reads → next inbound run dedups.
    const after = await prisma.message.findUniqueOrThrow({ where: { id: msg.id } });
    expect(after.externalSource).toBe('bitrix24');
    expect(after.externalId).toBe('bxchat:9001');
  });

  it('reconciles a duplicate mirror created by the inbound cron in the stamp gap', async () => {
    const { author, channel } = await collabSetup('458');
    const local = await prisma.message.create({
      data: { channelId: channel.id, authorId: author.id, body: 'гонка со стампом' },
    });
    // Simulate the hourly inbound sync having already mirrored THIS same Bitrix
    // message (id 9100) into a separate row during the sub-second gap.
    const mirror = await prisma.message.create({
      data: {
        channelId: channel.id,
        authorId: author.id,
        body: 'Игорь: гонка со стампом',
        externalSource: 'bitrix24',
        externalId: 'bxchat:9100',
      },
    });

    const { client } = captureClient(9100); // im.message.add returns the same id
    const r = await pushCollabChatMessage(prisma, client, local.id);
    expect(r.pushed).toBe(true);

    // The redundant mirror is gone; the original is stamped — exactly one row.
    expect(await prisma.message.findUnique({ where: { id: mirror.id } })).toBeNull();
    const after = await prisma.message.findUniqueOrThrow({ where: { id: local.id } });
    expect(after.externalId).toBe('bxchat:9100');
    expect(
      await prisma.message.count({ where: { externalSource: 'bitrix24', externalId: 'bxchat:9100' } }),
    ).toBe(1);
  });

  it('does NOT echo a mirrored message back to Bitrix (echo guard)', async () => {
    const { author, channel } = await collabSetup('457');
    const mirrored = await prisma.message.create({
      data: {
        channelId: channel.id,
        authorId: author.id,
        body: 'пришло из битрикса',
        externalSource: 'bitrix24',
        externalId: 'bxchat:555',
      },
    });

    const { client, calls } = captureClient(9002);
    const r = await pushCollabChatMessage(prisma, client, mirrored.id);
    expect(r.pushed).toBe(false);
    expect(calls.find((c) => c.method === 'im.message.add')).toBeUndefined();
  });

  it('ignores messages in non-collab channels', async () => {
    const author = await makeUser();
    const ch = await prisma.channel.create({
      data: { kind: 'PUBLIC', slug: 'general', name: 'Общий', createdById: author.id },
    });
    const msg = await prisma.message.create({
      data: { channelId: ch.id, authorId: author.id, body: 'обычное сообщение' },
    });

    const { client, calls } = captureClient(9003);
    const r = await pushCollabChatMessage(prisma, client, msg.id);
    expect(r.pushed).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
