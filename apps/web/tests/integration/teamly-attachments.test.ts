import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Integration tests for the T4 TEAMLY image localizer. A stub client + in-memory
 * storage exercise the download → KnowledgeAttachment → content-rewrite flow,
 * the externalId dedup on re-sync, the reconcile of removed images, and that
 * absolute/already-local urls are left untouched. Source:
 * apps/web/lib/integrations/teamlyAttachments.ts.
 */

import { prisma } from '@giper/db';
import {
  syncTeamlyAttachments,
  type TeamlyAttachmentStorage,
} from '@/lib/integrations/teamlyAttachments';

const REL = '/attachments/download/13638/pic.png';
const ABS = 'https://lh3.googleusercontent.com/abc';
const LOCAL_PREFIX = '/api/knowledge/attachments/';

/** In-memory S3 + a download-counting stub client. */
function harness() {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  let downloads = 0;
  const storage: TeamlyAttachmentStorage = {
    putObject: async ({ key, body, contentType }) => {
      objects.set(key, { body, contentType });
    },
    deleteObject: async (key) => {
      objects.delete(key);
    },
    buildKey: (articleId, filename) => `kb/${articleId}/${filename}`,
  };
  const client = {
    downloadFile: async (path: string) => {
      downloads++;
      return { bytes: Buffer.from(`bytes-of-${path}`), contentType: 'image/png' };
    },
  };
  return { objects, storage, client, downloads: () => downloads };
}

async function makeTeamlyArticle(content: string) {
  const space = await prisma.knowledgeSpace.create({
    data: { name: 'TEAMLY', externalSource: 'teamly', externalId: `sp-${Date.now()}` },
  });
  return prisma.knowledgeArticle.create({
    data: { spaceId: space.id, title: 'A', content, externalSource: 'teamly', externalId: `art-${Date.now()}` },
  });
}

beforeEach(async () => {
  await prisma.knowledgeAttachment.deleteMany({});
});

describe('syncTeamlyAttachments (T4)', () => {
  it('downloads a relative image, records it, and rewrites the content; leaves absolute/local alone', async () => {
    const h = harness();
    const article = await makeTeamlyArticle(
      `# T\n\n![one](${REL})\n\n![ext](${ABS})\n\n![already](${LOCAL_PREFIX}existing123)`,
    );

    const res = await syncTeamlyAttachments(h.client, { storage: h.storage });
    expect(res.downloaded).toBe(1);
    expect(h.downloads()).toBe(1); // only the relative url

    const att = await prisma.knowledgeAttachment.findFirst({
      where: { articleId: article.id, externalSource: 'teamly' },
    });
    expect(att).not.toBeNull();
    expect(att!.externalId).toBe(`${article.id}:${REL}`);
    expect(att!.mimeType).toBe('image/png');
    expect(h.objects.has(att!.storageKey)).toBe(true);

    const after = await prisma.knowledgeArticle.findUniqueOrThrow({ where: { id: article.id } });
    expect(after.content).toContain(`![one](${LOCAL_PREFIX}${att!.id})`);
    expect(after.content).toContain(`![ext](${ABS})`); // absolute untouched
    expect(after.content).toContain(`![already](${LOCAL_PREFIX}existing123)`); // already-local untouched
  });

  it('is idempotent — a re-sync reuses the stored file (no re-download)', async () => {
    const h = harness();
    const article = await makeTeamlyArticle(`![one](${REL})`);
    await syncTeamlyAttachments(h.client, { storage: h.storage });

    // Mirror the real cycle: runTeamlySync re-writes the relative url before the
    // attachment pass runs again.
    await prisma.knowledgeArticle.update({ where: { id: article.id }, data: { content: `![one](${REL})` } });
    const res2 = await syncTeamlyAttachments(h.client, { storage: h.storage });
    expect(res2.downloaded).toBe(0);
    expect(res2.reused).toBe(1);
    expect(h.downloads()).toBe(1); // still only the first download
    expect(await prisma.knowledgeAttachment.count({ where: { articleId: article.id } })).toBe(1);
  });

  it('reconciles: an image removed upstream is pruned (row + object)', async () => {
    const h = harness();
    const article = await makeTeamlyArticle(`![one](${REL})`);
    await syncTeamlyAttachments(h.client, { storage: h.storage });
    const before = await prisma.knowledgeAttachment.findFirstOrThrow({ where: { articleId: article.id } });

    // Source dropped the image (re-sync wrote content with another relative img).
    const REL2 = '/attachments/download/999/other.png';
    await prisma.knowledgeArticle.update({ where: { id: article.id }, data: { content: `![two](${REL2})` } });
    const res = await syncTeamlyAttachments(h.client, { storage: h.storage });

    expect(res.pruned).toBe(1);
    expect(await prisma.knowledgeAttachment.findUnique({ where: { id: before.id } })).toBeNull();
    expect(h.objects.has(before.storageKey)).toBe(false);
    // The new image was localized.
    expect(res.downloaded).toBe(1);
  });

  it('localizes a percent-encoded url (paren/space filename) and decodes the filename', async () => {
    const h = harness();
    const ENC = '/attachments/download/1/screenshot%20%281%29.png';
    const article = await makeTeamlyArticle(`![a](${ENC})`);

    const res = await syncTeamlyAttachments(h.client, { storage: h.storage });
    expect(res.downloaded).toBe(1);
    const att = await prisma.knowledgeAttachment.findFirstOrThrow({ where: { articleId: article.id } });
    expect(att.filename).toBe('screenshot (1).png'); // decoded
    const after = await prisma.knowledgeArticle.findUniqueOrThrow({ where: { id: article.id } });
    expect(after.content).toBe(`![a](${LOCAL_PREFIX}${att.id})`); // clean rewrite, no leak
  });

  it('skips a download that comes back null (too large / unavailable) without rewriting', async () => {
    const h = harness();
    const client = { downloadFile: async () => null };
    const article = await makeTeamlyArticle(`![one](${REL})`);
    const res = await syncTeamlyAttachments(client, { storage: h.storage });
    expect(res.downloaded).toBe(0);
    expect(res.errors.length).toBe(1);
    const after = await prisma.knowledgeArticle.findUniqueOrThrow({ where: { id: article.id } });
    expect(after.content).toContain(`![one](${REL})`); // unchanged
  });
});
