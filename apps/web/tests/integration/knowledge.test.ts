import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration tests for the Knowledge Base actions (slices A–C):
 * spaces, articles, draft/published, favorites (idempotent toggle), and
 * article templates (account + space scope, space-scope lock).
 *
 * Source: apps/web/actions/knowledge.ts, lib/knowledge/getKnowledge.ts
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
  setArticleStatusAction,
  toggleFavoriteArticleAction,
  createTemplateAction,
  createArticleFromTemplateAction,
} from '@/actions/knowledge';
import {
  searchKnowledge,
  getFavoriteIds,
  listTemplatesForSpace,
} from '@/lib/knowledge/getKnowledge';
import { makeUser } from './helpers/factories';

async function asUser(role: 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER') {
  const u = await makeUser({ role });
  mockMe.id = u.id;
  mockMe.role = role;
  return u;
}

beforeEach(() => {
  mockMe.role = 'ADMIN';
});

describe('knowledge — spaces & articles', () => {
  it('ADMIN creates a space; VIEWER cannot', async () => {
    await asUser('ADMIN');
    const ok = await createSpaceAction('Инженерия', '📘');
    expect(ok.ok).toBe(true);

    await asUser('VIEWER');
    const denied = await createSpaceAction('Тайное');
    expect(denied.ok).toBe(false);
    expect(await prisma.knowledgeSpace.count()).toBe(1);
  });

  it('creates and updates an article', async () => {
    await asUser('ADMIN');
    const sp = await createSpaceAction('Док');
    const spaceId = sp.ok ? sp.data!.id : '';
    const a = await createArticleAction(spaceId, null, 'Первая');
    expect(a.ok).toBe(true);
    const id = a.ok ? a.data!.id : '';

    const upd = await updateArticleAction(id, { title: 'Обновлено', content: '# Привет' });
    expect(upd.ok).toBe(true);
    const row = await prisma.knowledgeArticle.findUniqueOrThrow({ where: { id } });
    expect(row.title).toBe('Обновлено');
    expect(row.content).toBe('# Привет');
    expect(row.status).toBe('PUBLISHED');
  });

  it('VIEWER cannot create or restatus articles', async () => {
    await asUser('ADMIN');
    const sp = await createSpaceAction('S');
    const spaceId = sp.ok ? sp.data!.id : '';
    const a = await createArticleAction(spaceId, null);
    const id = a.ok ? a.data!.id : '';

    await asUser('VIEWER');
    expect((await createArticleAction(spaceId, null)).ok).toBe(false);
    expect((await setArticleStatusAction(id, 'DRAFT')).ok).toBe(false);
  });
});

describe('knowledge — draft/published & search', () => {
  it('drafts are excluded from search; published are found', async () => {
    const admin = await asUser('ADMIN');
    const sp = await createSpaceAction('Поиск');
    const spaceId = sp.ok ? sp.data!.id : '';
    const a = await createArticleAction(spaceId, null, 'Уникслово123');
    const id = a.ok ? a.data!.id : '';
    await updateArticleAction(id, { content: 'тело статьи' });

    expect((await searchKnowledge('Уникслово123', admin)).length).toBe(1);

    const toDraft = await setArticleStatusAction(id, 'DRAFT');
    expect(toDraft.ok).toBe(true);
    expect((await searchKnowledge('Уникслово123', admin)).length).toBe(0);

    await setArticleStatusAction(id, 'PUBLISHED');
    expect((await searchKnowledge('Уникслово123', admin)).length).toBe(1);
  });
});

describe('knowledge — favorites (idempotent toggle)', () => {
  it('toggles a favorite on then off, reflected in getFavoriteIds', async () => {
    const u = await asUser('MEMBER');
    // need a space + article owned by anyone
    mockMe.role = 'ADMIN';
    const sp = await createSpaceAction('Изб');
    const spaceId = sp.ok ? sp.data!.id : '';
    const a = await createArticleAction(spaceId, null, 'Звёздная');
    const id = a.ok ? a.data!.id : '';

    mockMe.id = u.id;
    mockMe.role = 'MEMBER';
    const on = await toggleFavoriteArticleAction(id);
    expect(on.ok && on.data?.favorited).toBe(true);
    expect((await getFavoriteIds(u.id)).articleIds).toContain(id);

    const off = await toggleFavoriteArticleAction(id);
    expect(off.ok && off.data?.favorited).toBe(false);
    expect((await getFavoriteIds(u.id)).articleIds).not.toContain(id);
  });

  it('toggling an already-favorited article removes it without a unique-key error', async () => {
    const u = await asUser('MEMBER');
    mockMe.role = 'ADMIN';
    const sp = await createSpaceAction('Гонка');
    const spaceId = sp.ok ? sp.data!.id : '';
    const a = await createArticleAction(spaceId, null);
    const id = a.ok ? a.data!.id : '';

    // Pre-insert the favorite directly, then toggle: the action's deleteMany
    // path must remove it and return favorited:false (no P2002, no throw).
    mockMe.id = u.id;
    mockMe.role = 'MEMBER';
    await prisma.knowledgeFavorite.create({ data: { userId: u.id, articleId: id } });
    const res = await toggleFavoriteArticleAction(id);
    expect(res.ok && res.data?.favorited).toBe(false);
    expect(await prisma.knowledgeFavorite.count({ where: { userId: u.id, articleId: id } })).toBe(0);
  });
});

describe('knowledge — templates', () => {
  it('ADMIN creates a template and an article from it copies the content', async () => {
    await asUser('ADMIN');
    const sp = await createSpaceAction('Шаб');
    const spaceId = sp.ok ? sp.data!.id : '';
    const tpl = await createTemplateAction({
      name: 'Регламент',
      scope: 'ACCOUNT',
      content: '## Цель\n- пункт',
      icon: '📋',
    });
    expect(tpl.ok).toBe(true);
    const templateId = tpl.ok ? tpl.data!.id : '';

    const art = await createArticleFromTemplateAction(spaceId, null, templateId);
    expect(art.ok).toBe(true);
    const row = await prisma.knowledgeArticle.findUniqueOrThrow({ where: { id: art.ok ? art.data!.id : '' } });
    expect(row.title).toBe('Регламент');
    expect(row.content).toBe('## Цель\n- пункт');
    expect(row.icon).toBe('📋');
  });

  it('space-scoped template cannot be used in a different space', async () => {
    await asUser('ADMIN');
    const a = await createSpaceAction('A');
    const b = await createSpaceAction('B');
    const aId = a.ok ? a.data!.id : '';
    const bId = b.ok ? b.data!.id : '';
    const tpl = await createTemplateAction({ name: 'Только A', scope: 'SPACE', spaceId: aId, content: 'x' });
    const templateId = tpl.ok ? tpl.data!.id : '';

    // applicable to A
    expect((await listTemplatesForSpace(aId)).some((t) => t.id === templateId)).toBe(true);
    // not applicable to B; using it in B is rejected
    expect((await listTemplatesForSpace(bId)).some((t) => t.id === templateId)).toBe(false);
    const wrong = await createArticleFromTemplateAction(bId, null, templateId);
    expect(wrong.ok).toBe(false);
  });

  it('VIEWER cannot create templates', async () => {
    await asUser('VIEWER');
    const res = await createTemplateAction({ name: 'Нельзя', scope: 'ACCOUNT' });
    expect(res.ok).toBe(false);
  });
});
