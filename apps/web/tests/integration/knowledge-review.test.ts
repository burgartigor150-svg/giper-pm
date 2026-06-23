import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration tests for KB article approval: request → approve (publishes) /
 * reject (stays draft) / cancel, with reviewer + manager authorization.
 *
 * Source: apps/web/actions/knowledgeReview.ts, lib/knowledge/getReview.ts
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
import { createSpaceAction, createArticleAction, setArticleStatusAction } from '@/actions/knowledge';
import {
  requestReviewAction,
  approveReviewAction,
  rejectReviewAction,
  cancelReviewAction,
} from '@/actions/knowledgeReview';
import { getLatestReview } from '@/lib/knowledge/getReview';
import { makeUser } from './helpers/factories';

function as(u: { id: string; role: string }) {
  mockMe.id = u.id;
  mockMe.role = u.role as typeof mockMe.role;
}

async function setup() {
  const admin = await makeUser({ role: 'ADMIN' });
  as(admin);
  const sp = await createSpaceAction('Согласование');
  const spaceId = sp.ok ? sp.data!.id : '';
  const a = await createArticleAction(spaceId, null, 'Черновик');
  const articleId = a.ok ? a.data!.id : '';
  await setArticleStatusAction(articleId, 'DRAFT');
  return { admin, spaceId, articleId };
}

beforeEach(() => {
  mockMe.role = 'ADMIN';
});

describe('kb approval', () => {
  it('request → approve publishes the article', async () => {
    const { admin, articleId } = await setup();
    const reviewer = await makeUser({ role: 'MEMBER' });
    as(admin);
    const req = await requestReviewAction(articleId, reviewer.id);
    expect(req.ok).toBe(true);
    expect((await getLatestReview(articleId))?.state).toBe('PENDING');

    // only the reviewer (or manager) approves; a random member cannot
    const stranger = await makeUser({ role: 'MEMBER' });
    as(stranger);
    expect((await approveReviewAction(req.ok ? req.data!.id : '')).ok).toBe(false);

    as(reviewer);
    expect((await approveReviewAction(req.ok ? req.data!.id : '')).ok).toBe(true);
    const art = await prisma.knowledgeArticle.findUniqueOrThrow({ where: { id: articleId } });
    expect(art.status).toBe('PUBLISHED');
    expect((await getLatestReview(articleId))?.state).toBe('APPROVED');
  });

  it('reject keeps the article a draft and stores the comment', async () => {
    const { admin, articleId } = await setup();
    const reviewer = await makeUser({ role: 'MEMBER' });
    as(admin);
    const req = await requestReviewAction(articleId, reviewer.id);
    as(reviewer);
    expect((await rejectReviewAction(req.ok ? req.data!.id : '', 'нужны правки')).ok).toBe(true);
    const art = await prisma.knowledgeArticle.findUniqueOrThrow({ where: { id: articleId } });
    expect(art.status).toBe('DRAFT');
    const r = await getLatestReview(articleId);
    expect(r?.state).toBe('REJECTED');
    expect(r?.comment).toBe('нужны правки');
  });

  it('rejects a second pending request while one is open', async () => {
    const { admin, articleId } = await setup();
    const reviewer = await makeUser({ role: 'MEMBER' });
    as(admin);
    expect((await requestReviewAction(articleId, reviewer.id)).ok).toBe(true);
    expect((await requestReviewAction(articleId, reviewer.id)).ok).toBe(false); // already pending
  });

  it('requester can cancel a pending request', async () => {
    const { admin, articleId } = await setup();
    const reviewer = await makeUser({ role: 'MEMBER' });
    as(admin);
    const req = await requestReviewAction(articleId, reviewer.id);
    expect((await cancelReviewAction(req.ok ? req.data!.id : '')).ok).toBe(true);
    expect(await getLatestReview(articleId)).toBeNull();
  });
});
