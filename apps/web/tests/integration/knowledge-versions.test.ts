import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration tests for KB article version history (slice F): snapshots on
 * edit, restore (which snapshots the current state first), and that icon-only
 * saves don't spawn versions.
 *
 * Source: apps/web/actions/knowledge.ts (updateArticleAction,
 *         restoreArticleVersionAction), lib/knowledge/getKnowledge.ts
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
import {
  createSpaceAction,
  createArticleAction,
  updateArticleAction,
  restoreArticleVersionAction,
} from '@/actions/knowledge';
import { listArticleVersions } from '@/lib/knowledge/getKnowledge';
import { makeUser } from './helpers/factories';

async function setup() {
  const admin = await makeUser({ role: 'ADMIN' });
  mockMe.id = admin.id;
  mockMe.role = 'ADMIN';
  const sp = await createSpaceAction('Версии');
  const spaceId = sp.ok ? sp.data!.id : '';
  const a = await createArticleAction(spaceId, null, 'V0');
  return { id: a.ok ? a.data!.id : '' };
}

beforeEach(() => {
  mockMe.role = 'ADMIN';
});

describe('kb versions', () => {
  it('snapshots the prior state on each content change', async () => {
    const { id } = await setup();
    await updateArticleAction(id, { content: 'версия 1' });
    await updateArticleAction(id, { content: 'версия 2' });

    const versions = await listArticleVersions(id);
    // Two edits → two prior-state snapshots (empty original, then 'версия 1').
    expect(versions.length).toBe(2);
    // Newest first: the snapshot taken before the 2nd edit holds 'версия 1'.
    expect(versions[0]?.content).toBe('версия 1');
  });

  it('does not snapshot on an icon-only (or no-op) save', async () => {
    const { id } = await setup();
    await updateArticleAction(id, { content: 'тело' }); // 1 version (empty original)
    await updateArticleAction(id, { icon: '📌' }); // icon only → no new version
    await updateArticleAction(id, { content: 'тело' }); // unchanged content → no new version

    expect((await listArticleVersions(id)).length).toBe(1);
  });

  it('restores a version and snapshots the current state first', async () => {
    const { id } = await setup();
    await updateArticleAction(id, { content: 'первая' });
    await updateArticleAction(id, { content: 'вторая' });

    const versions = await listArticleVersions(id);
    const firstVersion = versions.find((v) => v.content === 'первая');
    expect(firstVersion).toBeTruthy();

    const res = await restoreArticleVersionAction(firstVersion!.id);
    expect(res.ok).toBe(true);

    const article = await prisma.knowledgeArticle.findUniqueOrThrow({ where: { id } });
    expect(article.content).toBe('первая');
    // Restore snapshots the pre-restore current ('вторая') → +1 version.
    const after = await listArticleVersions(id);
    expect(after.some((v) => v.content === 'вторая')).toBe(true);
    expect(after.length).toBe(versions.length + 1);
  });

  it('VIEWER cannot restore a version', async () => {
    const { id } = await setup();
    await updateArticleAction(id, { content: 'x' });
    const v = (await listArticleVersions(id))[0]!;

    const viewer = await makeUser({ role: 'VIEWER' });
    mockMe.id = viewer.id;
    mockMe.role = 'VIEWER';
    expect((await restoreArticleVersionAction(v.id)).ok).toBe(false);
  });
});
