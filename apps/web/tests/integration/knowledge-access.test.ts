import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration tests for Knowledge Base per-space access (slice E): private
 * spaces, membership roles, and that visibility/edit gates actually hold —
 * the security-critical surface.
 *
 * Source: apps/web/lib/knowledge/access.ts, actions/knowledge.ts
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
  setSpaceVisibilityAction,
  addSpaceMemberAction,
  removeSpaceMemberAction,
} from '@/actions/knowledge';
import {
  listKnowledgeSpaces,
  searchKnowledge,
} from '@/lib/knowledge/getKnowledge';
import { getSpaceAccessById } from '@/lib/knowledge/access';
import { makeUser } from './helpers/factories';

function as(user: { id: string; role: string }) {
  mockMe.id = user.id;
  mockMe.role = user.role as typeof mockMe.role;
}

async function makeUserAs(role: 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER') {
  const u = await makeUser({ role });
  return u;
}

beforeEach(() => {
  mockMe.role = 'ADMIN';
});

describe('kb access — private spaces', () => {
  it('non-member cannot view or edit a private space; member can', async () => {
    const admin = await makeUserAs('ADMIN');
    const member = await makeUserAs('MEMBER');
    const outsider = await makeUserAs('MEMBER');

    as(admin);
    const sp = await createSpaceAction('Секретное');
    const spaceId = sp.ok ? sp.data!.id : '';
    await setSpaceVisibilityAction(spaceId, 'PRIVATE');
    await addSpaceMemberAction(spaceId, member.id, 'EDITOR');

    // Outsider: no view, no edit.
    as(outsider);
    const outAccess = await getSpaceAccessById(outsider, spaceId);
    expect(outAccess.canView).toBe(false);
    expect(outAccess.canEdit).toBe(false);
    expect((await createArticleAction(spaceId, null)).ok).toBe(false);
    expect((await listKnowledgeSpaces(outsider)).some((s) => s.id === spaceId)).toBe(false);

    // Member (EDITOR): view + edit, but not manage.
    as(member);
    const memAccess = await getSpaceAccessById(member, spaceId);
    expect(memAccess.canView).toBe(true);
    expect(memAccess.canEdit).toBe(true);
    expect(memAccess.canManage).toBe(false);
    expect((await createArticleAction(spaceId, null)).ok).toBe(true);
    expect((await listKnowledgeSpaces(member)).some((s) => s.id === spaceId)).toBe(true);
  });

  it('global ADMIN can view/manage every private space without membership', async () => {
    const admin = await makeUserAs('ADMIN');
    const other = await makeUserAs('PM');
    as(other);
    const sp = await createSpaceAction('Чужое приватное');
    const spaceId = sp.ok ? sp.data!.id : '';
    await setSpaceVisibilityAction(spaceId, 'PRIVATE');

    as(admin);
    const acc = await getSpaceAccessById(admin, spaceId);
    expect(acc.canView).toBe(true);
    expect(acc.canManage).toBe(true);
  });

  it('only managers can change visibility or manage members', async () => {
    const admin = await makeUserAs('ADMIN');
    const editor = await makeUserAs('MEMBER');
    as(admin);
    const sp = await createSpaceAction('Управление');
    const spaceId = sp.ok ? sp.data!.id : '';
    await setSpaceVisibilityAction(spaceId, 'PRIVATE');
    await addSpaceMemberAction(spaceId, editor.id, 'EDITOR');

    // EDITOR member cannot manage members or visibility.
    as(editor);
    expect((await addSpaceMemberAction(spaceId, admin.id, 'EDITOR')).ok).toBe(false);
    expect((await setSpaceVisibilityAction(spaceId, 'PUBLIC')).ok).toBe(false);
    expect((await removeSpaceMemberAction(spaceId, editor.id)).ok).toBe(false);

    // Promote to MANAGER → can manage.
    as(admin);
    await addSpaceMemberAction(spaceId, editor.id, 'MANAGER');
    as(editor);
    const acc = await getSpaceAccessById(editor, spaceId);
    expect(acc.canManage).toBe(true);
    expect((await addSpaceMemberAction(spaceId, admin.id, 'EDITOR')).ok).toBe(true);
  });

  it('search hides private-space articles from non-members', async () => {
    const admin = await makeUserAs('ADMIN');
    const outsider = await makeUserAs('MEMBER');
    as(admin);
    const sp = await createSpaceAction('Приват-поиск');
    const spaceId = sp.ok ? sp.data!.id : '';
    const a = await createArticleAction(spaceId, null, 'СекретТермин999');
    // article is PUBLISHED by default; make space private after creation
    await setSpaceVisibilityAction(spaceId, 'PRIVATE');

    // Admin (global) still finds it; outsider does not.
    expect((await searchKnowledge('СекретТермин999', admin)).some((r) => r.id === (a.ok ? a.data!.id : ''))).toBe(true);
    expect((await searchKnowledge('СекретТермин999', outsider)).length).toBe(0);
  });

  it('public spaces stay readable by everyone (non-breaking default)', async () => {
    const admin = await makeUserAs('ADMIN');
    const viewer = await makeUserAs('VIEWER');
    as(admin);
    const sp = await createSpaceAction('Открытое');
    const spaceId = sp.ok ? sp.data!.id : '';

    as(viewer);
    const acc = await getSpaceAccessById(viewer, spaceId);
    expect(acc.canView).toBe(true); // public → anyone reads
    expect(acc.canEdit).toBe(false); // but a global VIEWER can't edit
    expect((await listKnowledgeSpaces(viewer)).some((s) => s.id === spaceId)).toBe(true);
  });
});
