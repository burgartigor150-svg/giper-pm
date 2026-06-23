import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import {
  runKaitenSync,
  syncKaitenUsers,
  type KaitenCard,
  type KaitenComment,
  type KaitenUser,
  type KaitenClient,
} from '@giper/integrations/kaiten';
import { makeUser, makeProject } from './helpers/factories';

function fakeClient(opts: {
  cards?: KaitenCard[][];
  comments?: Record<number, KaitenComment[]>;
  users?: KaitenUser[];
}): KaitenClient {
  return {
    async *listCardsPaged() {
      for (const p of opts.cards ?? []) yield p;
    },
    async listCardComments(id: number) {
      return opts.comments?.[id] ?? [];
    },
    async listCardFiles() {
      return [];
    },
    async listUsers() {
      return opts.users ?? [];
    },
  } as unknown as KaitenClient;
}

function card(over: Partial<KaitenCard> & { id: number; title: string }): KaitenCard {
  return {
    state: 1,
    archived: false,
    condition: 1,
    board_id: 7,
    column_id: 1,
    lane_id: null,
    owner_id: null,
    due_date: null,
    external_id: null,
    comments_total: 0,
    created: '2026-06-01T00:00:00Z',
    updated: '2026-06-01T00:00:00Z',
    description: '',
    ...over,
  };
}

function kUser(over: Partial<KaitenUser> & { id: number }): KaitenUser {
  return { full_name: `User ${over.id}`, email: `k${over.id}@ex.com`, username: `u${over.id}`, activated: true, ...over };
}

describe('syncKaitenUsers', () => {
  it('links an existing user by email and creates new active users; skips virtual', async () => {
    const local = await makeUser({ email: 'match@ex.com', name: 'Local' });
    const client = fakeClient({
      users: [
        kUser({ id: 5001, email: 'MATCH@ex.com', full_name: 'From Kaiten' }), // case-insensitive match
        kUser({ id: 5002, email: 'new@ex.com', full_name: 'Новый' }),
        { id: 5003, email: null, full_name: 'No email', username: null }, // can't create
        { id: 5004, email: 'bot@ex.com', full_name: 'Bot', username: null, virtual: true }, // skipped
      ],
    });

    const res = await syncKaitenUsers(prisma, client);
    expect(res.created).toBe(1); // only new@ex.com
    expect(res.matched).toBe(1); // match@ex.com

    const linked = await prisma.user.findUniqueOrThrow({ where: { id: local.id } });
    expect(linked.kaitenUserId).toBe('5001');

    const created = await prisma.user.findUniqueOrThrow({ where: { email: 'new@ex.com' } });
    expect(created.kaitenUserId).toBe('5002');
    expect(created.isActive).toBe(true);

    expect(await prisma.user.findUnique({ where: { email: 'bot@ex.com' } })).toBeNull();
  });

  it('never auto-links a Kaiten user to a privileged (ADMIN/PM) account by email', async () => {
    const admin = await makeUser({ email: 'boss@ex.com', name: 'Boss', role: 'ADMIN' });
    const res = await syncKaitenUsers(prisma, fakeClient({ users: [kUser({ id: 7001, email: 'BOSS@ex.com' })] }));
    expect(res.linked).toBe(0);
    const a = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(a.kaitenUserId).toBeNull();
  });
});

describe('runKaitenSync with syncUsers', () => {
  it('sets assignee from card owner, adds members, attributes comments to real users', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });

    const res = await runKaitenSync(
      prisma,
      fakeClient({
        users: [kUser({ id: 6001, email: 'owner@ex.com', full_name: 'Владелец' }), kUser({ id: 6002, email: 'author@ex.com', full_name: 'Автор' })],
        cards: [[card({ id: 900, title: 'Задача', owner_id: 6001, comments_total: 1 })]],
        comments: { 900: [{ id: 1, text: 'привет', author_id: 6002, author: { full_name: 'Автор' }, created: '2026-06-01T00:00:00Z', updated: '2026-06-01T00:00:00Z' }] },
      }),
      { projectId: project.id, boardId: 7, syncUsers: true, syncComments: true },
    );
    expect(res.usersCreated).toBe(2);

    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: 'owner@ex.com' } });
    const authorUser = await prisma.user.findUniqueOrThrow({ where: { email: 'author@ex.com' } });

    // Assignee = card owner's local user.
    const task = await prisma.task.findFirstOrThrow({
      where: { projectId: project.id, externalSource: 'kaiten', externalId: '900' },
    });
    expect(task.assigneeId).toBe(ownerUser.id);

    // Both owner and comment author are project members.
    const memberIds = (await prisma.projectMember.findMany({ where: { projectId: project.id }, select: { userId: true } })).map((m) => m.userId);
    expect(memberIds).toContain(ownerUser.id);
    expect(memberIds).toContain(authorUser.id);

    // Comment attributed to the real author (not the bot), and no name prefix.
    const comment = await prisma.comment.findFirstOrThrow({ where: { taskId: task.id } });
    expect(comment.authorId).toBe(authorUser.id);
    expect(comment.body).toBe('привет');
  });
});
