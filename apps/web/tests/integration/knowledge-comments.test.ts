import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration tests for KB comments + reactions: comment/reply/edit/delete with
 * author + manager rules, access gating (private space), and race-safe reaction
 * toggling.
 *
 * Source: apps/web/actions/knowledgeComments.ts, lib/knowledge/getComments.ts
 */

const mockMe = {
  id: '',
  role: 'ADMIN' as 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER',
  name: 'A',
  email: 'a@a',
  image: null,
  mustChangePassword: false,
};

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => mockMe),
  requireRole: vi.fn(async () => mockMe),
  signOut: vi.fn(),
  signIn: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@giper/db';
import { createSpaceAction, createArticleAction, setSpaceVisibilityAction } from '@/actions/knowledge';
import {
  addCommentAction,
  updateCommentAction,
  deleteCommentAction,
  toggleArticleReactionAction,
  toggleCommentReactionAction,
} from '@/actions/knowledgeComments';
import { getArticleComments, getArticleReactions } from '@/lib/knowledge/getComments';
import { makeUser } from './helpers/factories';

function as(u: { id: string; role: string }) {
  mockMe.id = u.id;
  mockMe.role = u.role as typeof mockMe.role;
}

async function setup() {
  const admin = await makeUser({ role: 'ADMIN' });
  as(admin);
  const sp = await createSpaceAction('Обсуждение');
  const spaceId = sp.ok ? sp.data!.id : '';
  const a = await createArticleAction(spaceId, null, 'Статья');
  return { admin, spaceId, articleId: a.ok ? a.data!.id : '' };
}

beforeEach(() => {
  mockMe.role = 'ADMIN';
});

describe('kb comments', () => {
  it('adds a comment and a reply (one-level tree)', async () => {
    const { admin, articleId } = await setup();
    const c = await addCommentAction(articleId, 'Корневой');
    expect(c.ok).toBe(true);
    const r = await addCommentAction(articleId, 'Ответ', c.ok ? c.data!.id : '');
    expect(r.ok).toBe(true);

    const tree = await getArticleComments(articleId, admin.id);
    expect(tree.length).toBe(1);
    expect(tree[0]?.replies.length).toBe(1);
    expect(tree[0]?.replies[0]?.body).toBe('Ответ');
  });

  it('rejects empty comments', async () => {
    const { articleId } = await setup();
    expect((await addCommentAction(articleId, '   ')).ok).toBe(false);
  });

  it('only the author edits; author or manager deletes', async () => {
    const { admin, articleId } = await setup();
    const other = await makeUser({ role: 'MEMBER' });

    as(other);
    const c = await addCommentAction(articleId, 'Чужой');
    const id = c.ok ? c.data!.id : '';

    // admin (not author) cannot EDIT
    as(admin);
    expect((await updateCommentAction(id, 'правка')).ok).toBe(false);
    // author can edit
    as(other);
    expect((await updateCommentAction(id, 'правка')).ok).toBe(true);
    // admin (space manager) CAN delete someone else's comment
    as(admin);
    expect((await deleteCommentAction(id)).ok).toBe(true);
    expect(await prisma.knowledgeComment.count({ where: { id } })).toBe(0);
  });

  it('non-member cannot comment on a private space', async () => {
    const { admin, spaceId, articleId } = await setup();
    as(admin);
    await setSpaceVisibilityAction(spaceId, 'PRIVATE');
    const outsider = await makeUser({ role: 'MEMBER' });
    as(outsider);
    expect((await addCommentAction(articleId, 'нельзя')).ok).toBe(false);
  });
});

describe('kb reactions', () => {
  it('toggles an article reaction on then off (idempotent), grouped with counts', async () => {
    const { admin, articleId } = await setup();
    const on = await toggleArticleReactionAction(articleId, '👍');
    expect(on.ok && on.data?.reacted).toBe(true);
    let groups = await getArticleReactions(articleId, admin.id);
    expect(groups.find((g) => g.emoji === '👍')?.count).toBe(1);
    expect(groups.find((g) => g.emoji === '👍')?.mine).toBe(true);

    const off = await toggleArticleReactionAction(articleId, '👍');
    expect(off.ok && off.data?.reacted).toBe(false);
    groups = await getArticleReactions(articleId, admin.id);
    expect(groups.find((g) => g.emoji === '👍')).toBeUndefined();
  });

  it('toggles a comment reaction', async () => {
    const { admin, articleId } = await setup();
    const c = await addCommentAction(articleId, 'текст');
    const id = c.ok ? c.data!.id : '';
    expect((await toggleCommentReactionAction(id, '🔥')).ok).toBe(true);
    const tree = await getArticleComments(articleId, admin.id);
    expect(tree[0]?.reactions.find((g) => g.emoji === '🔥')?.count).toBe(1);
  });
});
