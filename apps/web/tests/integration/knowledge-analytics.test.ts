import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration tests for KB view analytics: dedup per user/day, counts, space
 * aggregation, and the private-space gate on recording.
 *
 * Source: apps/web/actions/knowledgeAnalytics.ts, lib/knowledge/getAnalytics.ts
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
import { recordArticleViewAction } from '@/actions/knowledgeAnalytics';
import { getArticleViewCount, getSpaceAnalytics } from '@/lib/knowledge/getAnalytics';
import { makeUser } from './helpers/factories';

function as(u: { id: string; role: string }) {
  mockMe.id = u.id;
  mockMe.role = u.role as typeof mockMe.role;
}

async function setup() {
  const admin = await makeUser({ role: 'ADMIN' });
  as(admin);
  const sp = await createSpaceAction('Аналитика');
  const spaceId = sp.ok ? sp.data!.id : '';
  const a = await createArticleAction(spaceId, null, 'Статья');
  return { admin, spaceId, articleId: a.ok ? a.data!.id : '' };
}

beforeEach(() => {
  mockMe.role = 'ADMIN';
});

describe('kb analytics', () => {
  it('dedups repeated views by the same user/day to a single count', async () => {
    const { admin, articleId } = await setup();
    as(admin);
    await recordArticleViewAction(articleId);
    await recordArticleViewAction(articleId);
    await recordArticleViewAction(articleId);
    expect(await getArticleViewCount(articleId)).toBe(1);

    // a different user adds another unique view
    const other = await makeUser({ role: 'MEMBER' });
    as(other);
    await recordArticleViewAction(articleId);
    expect(await getArticleViewCount(articleId)).toBe(2);
  });

  it('non-member view of a private space is not recorded', async () => {
    const { admin, spaceId, articleId } = await setup();
    as(admin);
    await setSpaceVisibilityAction(spaceId, 'PRIVATE');
    const outsider = await makeUser({ role: 'MEMBER' });
    as(outsider);
    await recordArticleViewAction(articleId);
    expect(await getArticleViewCount(articleId)).toBe(0);
  });

  it('space analytics aggregates totals, top articles and a 7-day series', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    as(admin);
    const sp = await createSpaceAction('Простр');
    const spaceId = sp.ok ? sp.data!.id : '';
    const a1 = await createArticleAction(spaceId, null, 'Первая');
    const a2 = await createArticleAction(spaceId, null, 'Вторая');
    const id1 = a1.ok ? a1.data!.id : '';
    const id2 = a2.ok ? a2.data!.id : '';

    const u1 = await makeUser({ role: 'MEMBER' });
    const u2 = await makeUser({ role: 'MEMBER' });
    for (const u of [admin, u1, u2]) { as(u); await recordArticleViewAction(id1); }
    as(u1); await recordArticleViewAction(id2);

    const an = await getSpaceAnalytics(spaceId);
    expect(an.totalViews).toBe(4);
    expect(an.topArticles[0]?.id).toBe(id1);
    expect(an.topArticles[0]?.views).toBe(3);
    expect(an.last7Days.length).toBe(7);
    const today = new Date().toISOString().slice(0, 10);
    expect(an.last7Days.find((d) => d.day === today)?.count).toBe(4);
  });
});
