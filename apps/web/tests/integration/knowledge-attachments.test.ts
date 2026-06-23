import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration tests for KB article attachments (KB-6): upload/delete with
 * per-space access control. S3 is mocked (no MinIO needed); the DB rows + the
 * permission gates are exercised for real.
 *
 * Source: apps/web/actions/knowledgeAttachments.ts
 */

const mockMe = { id: '', role: 'ADMIN' as string, name: 'A', email: 'a@a', image: null, mustChangePassword: false };

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => mockMe),
  requireRole: vi.fn(async () => mockMe),
  signOut: vi.fn(),
  signIn: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const putObject = vi.fn(async () => {});
const deleteObject = vi.fn(async () => {});
vi.mock('@/lib/storage/s3', () => ({
  putObject: (...a: unknown[]) => putObject(...a),
  deleteObject: (...a: unknown[]) => deleteObject(...a),
  buildKbAttachmentKey: (articleId: string, filename: string) => `knowledge/${articleId}/x-${filename}`,
}));

import { prisma } from '@giper/db';
import { makeUser } from './helpers/factories';
import { createSpace, createArticle } from '@/lib/knowledge/writeService';
import { uploadKbAttachmentAction, deleteKbAttachmentAction } from '@/actions/knowledgeAttachments';

function as(u: { id: string; role: string }) {
  mockMe.id = u.id;
  mockMe.role = u.role;
}

function fileFormData(articleId: string, name = 'doc.pdf', type = 'application/pdf') {
  const fd = new FormData();
  fd.set('articleId', articleId);
  fd.set('file', new File([new Uint8Array([1, 2, 3, 4])], name, { type }));
  return fd;
}

beforeEach(() => {
  putObject.mockClear();
  deleteObject.mockClear();
  mockMe.role = 'ADMIN';
});

describe('kb attachments — upload', () => {
  it('an editor uploads a file (S3 + row created)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    as(admin);
    const { id: spaceId } = await createSpace(admin, { name: 'Файлы' });
    const { id: articleId } = await createArticle(admin, { spaceId, title: 'A' });

    const res = await uploadKbAttachmentAction(fileFormData(articleId));
    expect(res.ok).toBe(true);
    expect(putObject).toHaveBeenCalledOnce();
    const row = await prisma.knowledgeAttachment.findUniqueOrThrow({ where: { id: res.ok ? res.data!.id : '' } });
    expect(row.filename).toBe('doc.pdf');
    expect(row.storageKey).toContain(`knowledge/${articleId}/`);
  });

  it('rejects an empty file and a disallowed mime type', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    as(admin);
    const { id: spaceId } = await createSpace(admin, { name: 'Файлы2' });
    const { id: articleId } = await createArticle(admin, { spaceId, title: 'B' });

    const empty = new FormData();
    empty.set('articleId', articleId);
    empty.set('file', new File([], 'empty.txt', { type: 'text/plain' }));
    expect((await uploadKbAttachmentAction(empty)).ok).toBe(false);

    const badMime = new FormData();
    badMime.set('articleId', articleId);
    badMime.set('file', new File([new Uint8Array([1, 2])], 'f.woff2', { type: 'font/woff2' }));
    expect((await uploadKbAttachmentAction(badMime)).ok).toBe(false);

    // script-executable types are rejected at upload (stored-XSS defense)
    for (const t of ['text/html', 'image/svg+xml', 'application/xhtml+xml', 'text/javascript']) {
      const fd = new FormData();
      fd.set('articleId', articleId);
      fd.set('file', new File([new Uint8Array([60, 33])], 'x', { type: t }));
      expect((await uploadKbAttachmentAction(fd)).ok).toBe(false);
    }

    expect(putObject).not.toHaveBeenCalled();
  });

  it('a VIEWER cannot upload to a PUBLIC space', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    as(admin);
    const { id: spaceId } = await createSpace(admin, { name: 'Публичное' });
    const { id: articleId } = await createArticle(admin, { spaceId, title: 'C' });

    const viewer = await makeUser({ role: 'VIEWER' });
    as(viewer);
    const res = await uploadKbAttachmentAction(fileFormData(articleId));
    expect(res.ok).toBe(false);
    expect(putObject).not.toHaveBeenCalled();
  });

  it('a non-member cannot upload to a PRIVATE space', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    as(admin);
    const { id: spaceId } = await createSpace(admin, { name: 'Приватное' });
    await prisma.knowledgeSpace.update({ where: { id: spaceId }, data: { visibility: 'PRIVATE' } });
    const { id: articleId } = await createArticle(admin, { spaceId, title: 'D' });

    const member = await makeUser({ role: 'MEMBER' });
    as(member);
    expect((await uploadKbAttachmentAction(fileFormData(articleId))).ok).toBe(false);
  });
});

describe('kb attachments — delete', () => {
  async function seed() {
    const admin = await makeUser({ role: 'ADMIN' });
    as(admin);
    const { id: spaceId } = await createSpace(admin, { name: 'Удаление' });
    const { id: articleId } = await createArticle(admin, { spaceId, title: 'E' });
    const up = await uploadKbAttachmentAction(fileFormData(articleId));
    return { admin, spaceId, articleId, attId: up.ok ? up.data!.id : '' };
  }

  it('an editor deletes (S3 + row removed)', async () => {
    const { admin, attId } = await seed();
    as(admin);
    expect((await deleteKbAttachmentAction(attId)).ok).toBe(true);
    expect(deleteObject).toHaveBeenCalledOnce();
    expect(await prisma.knowledgeAttachment.count({ where: { id: attId } })).toBe(0);
  });

  it('a random member without edit rights cannot delete', async () => {
    const { spaceId, attId } = await seed();
    await prisma.knowledgeSpace.update({ where: { id: spaceId }, data: { visibility: 'PRIVATE' } });
    const stranger = await makeUser({ role: 'MEMBER' });
    as(stranger);
    expect((await deleteKbAttachmentAction(attId)).ok).toBe(false);
    expect(await prisma.knowledgeAttachment.count({ where: { id: attId } })).toBe(1);
  });
});
