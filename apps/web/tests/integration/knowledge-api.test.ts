import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';

/**
 * Integration tests for the public KB REST API (KB-4). Exercises the real route
 * handlers end-to-end: gpm_ token auth → handler → writeService → DB, plus
 * per-space access control. Setup uses the writeService directly (takes a user).
 *
 * Source: apps/web/app/api/public/v1/knowledge/**, lib/knowledge/writeService.ts
 */

// mockMe is read by the mocked requireAuth (used only to seed a table via
// createTableAction). Its name starts with "mock" so vi.mock may close over it.
const mockMe = { id: '', role: 'ADMIN' as string, name: 'A', email: 'a@a', image: null, mustChangePassword: false };

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => mockMe),
  requireRole: vi.fn(async () => mockMe),
  signOut: vi.fn(),
  signIn: vi.fn(),
}));

import { prisma } from '@giper/db';
import { makeUser } from './helpers/factories';
import { createSpace } from '@/lib/knowledge/writeService';
import { createTableAction } from '@/actions/knowledgeTables';

import { GET as listSpaces, POST as postSpace } from '@/app/api/public/v1/knowledge/spaces/route';
import { GET as getSpaceDetail } from '@/app/api/public/v1/knowledge/spaces/[id]/route';
import { POST as postArticle } from '@/app/api/public/v1/knowledge/spaces/[id]/articles/route';
import { GET as getArt, PATCH as patchArt, DELETE as delArt } from '@/app/api/public/v1/knowledge/articles/[id]/route';
import { GET as search } from '@/app/api/public/v1/knowledge/search/route';
import { GET as getTableRoute } from '@/app/api/public/v1/knowledge/tables/[id]/route';

function sha256(s: string) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

async function mintToken(userId: string): Promise<string> {
  const raw = `gpm_${crypto.randomBytes(24).toString('hex')}`;
  await prisma.apiToken.create({ data: { userId, name: 't', tokenHash: sha256(raw), prefix: raw.slice(0, 12) } });
  return raw;
}

function req(token: string | null, init?: { method?: string; body?: unknown; url?: string }) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(init?.url ?? 'http://localhost/api', {
    method: init?.method ?? 'GET',
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}
const P = <T,>(v: T) => Promise.resolve(v);

describe('KB REST API — auth', () => {
  it('rejects requests without a token', async () => {
    const res = await listSpaces(req(null));
    expect(res.status).toBe(401);
  });
  it('rejects a revoked token', async () => {
    const u = await makeUser({ role: 'ADMIN' });
    const raw = await mintToken(u.id);
    await prisma.apiToken.updateMany({ where: { userId: u.id }, data: { revokedAt: new Date() } });
    const res = await listSpaces(req(raw));
    expect(res.status).toBe(401);
  });
});

describe('KB REST API — spaces & articles', () => {
  it('lists, creates, reads, updates and deletes via the API', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const token = await mintToken(admin.id);

    // POST create space
    const created = await postSpace(req(token, { method: 'POST', body: { name: 'API-пространство', icon: '📦' } }));
    expect(created.status).toBe(201);
    const { data: sp } = await created.json();
    const spaceId = sp.id as string;

    // GET list includes it
    const list = await listSpaces(req(token));
    const listed = await list.json();
    expect(listed.data.spaces.some((s: { id: string }) => s.id === spaceId)).toBe(true);

    // POST article with content + published status
    const artRes = await postArticle(req(token, { method: 'POST', body: { title: 'Гайд', content: '# Привет', status: 'PUBLISHED' } }), { params: P({ id: spaceId }) });
    expect(artRes.status).toBe(201);
    const { data: art } = await artRes.json();
    const articleId = art.id as string;

    // GET article returns content + status
    const got = await getArt(req(token), { params: P({ id: articleId }) });
    const gotBody = await got.json();
    expect(gotBody.data.article.content).toBe('# Привет');
    expect(gotBody.data.article.status).toBe('PUBLISHED');

    // PATCH updates content (snapshots a version)
    const patched = await patchArt(req(token, { method: 'PATCH', body: { content: '# Обновлено' } }), { params: P({ id: articleId }) });
    expect(patched.status).toBe(200);
    const row = await prisma.knowledgeArticle.findUniqueOrThrow({ where: { id: articleId } });
    expect(row.content).toBe('# Обновлено');
    expect(await prisma.knowledgeArticleVersion.count({ where: { articleId } })).toBe(1);

    // search finds the published article
    const sr = await search(req(token, { url: 'http://localhost/api?q=Обновлено' }));
    const srBody = await sr.json();
    expect(srBody.data.results.some((r: { id: string }) => r.id === articleId)).toBe(true);

    // DELETE removes it
    const del = await delArt(req(token, { method: 'DELETE' }), { params: P({ id: articleId }) });
    expect(del.status).toBe(200);
    expect(await prisma.knowledgeArticle.count({ where: { id: articleId } })).toBe(0);
  });

  it('POST with status DRAFT creates a DRAFT article that stays out of search', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const token = await mintToken(admin.id);
    const { id: spaceId } = await createSpace(admin, { name: 'Черновики' });

    const res = await postArticle(
      req(token, { method: 'POST', body: { title: 'Скрытая', content: 'СекретУникум777', status: 'DRAFT' } }),
      { params: P({ id: spaceId }) },
    );
    expect(res.status).toBe(201);
    const { data } = await res.json();
    const row = await prisma.knowledgeArticle.findUniqueOrThrow({ where: { id: data.id } });
    expect(row.status).toBe('DRAFT'); // must NOT silently become PUBLISHED

    const sr = await search(req(token, { url: 'http://localhost/api?q=СекретУникум777' }));
    const srBody = await sr.json();
    expect(srBody.data.results.length).toBe(0); // drafts are hidden from search
  });

  it('enforces per-space access: VIEWER cannot create a space; non-member cannot read a PRIVATE space', async () => {
    // VIEWER token cannot create a space (ADMIN/PM only)
    const viewer = await makeUser({ role: 'VIEWER' });
    const vToken = await mintToken(viewer.id);
    const denied = await postSpace(req(vToken, { method: 'POST', body: { name: 'Нельзя' } }));
    expect(denied.status).toBe(403);

    // Admin creates a PRIVATE space; a plain MEMBER (non-member) cannot view it
    const admin = await makeUser({ role: 'ADMIN' });
    const { id: spaceId } = await createSpace(admin, { name: 'Секрет' });
    await prisma.knowledgeSpace.update({ where: { id: spaceId }, data: { visibility: 'PRIVATE' } });

    const member = await makeUser({ role: 'MEMBER' });
    const mToken = await mintToken(member.id);
    const res = await getSpaceDetail(req(mToken), { params: P({ id: spaceId }) });
    expect(res.status).toBe(403);
  });

  it('returns a smart table with columns, rows and resolved relations', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    mockMe.role = 'ADMIN';
    const token = await mintToken(admin.id);
    const { id: spaceId } = await createSpace(admin, { name: 'Табличное' });

    const t = await createTableAction(spaceId, 'Реестр');
    const tableId = t.ok ? t.data!.id : '';

    const res = await getTableRoute(req(token), { params: P({ id: tableId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.table.id).toBe(tableId);
    expect(body.data.table.columns.length).toBeGreaterThan(0);
    expect(body.data.table).toHaveProperty('relations');
  });
});
