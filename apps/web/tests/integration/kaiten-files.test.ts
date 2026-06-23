import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import type { KaitenClient, KaitenFile } from '@giper/integrations/kaiten';
import { syncKaitenFiles, type KaitenFileStorage } from '@/lib/integrations/kaitenFiles';
import { makeUser, makeProject, makeTask } from './helpers/factories';

function fakeClient(filesByCard: Record<number, KaitenFile[]>): KaitenClient {
  return {
    async listCardFiles(cardId: number) {
      return filesByCard[cardId] ?? [];
    },
  } as unknown as KaitenClient;
}

function file(over: Partial<KaitenFile> & { id: number; name: string }): KaitenFile {
  return {
    mime_type: 'image/png',
    size: 100,
    url: `https://files.kaiten.ru/${over.id}.png`,
    deleted: false,
    ...over,
  };
}

/** In-memory storage stand-in: records puts/deletes, fakes downloads. */
function memStorage() {
  const puts = new Map<string, Buffer>();
  const deletes: string[] = [];
  const storage: KaitenFileStorage = {
    async putObject({ key, body }) {
      puts.set(key, body);
    },
    async deleteObject(key) {
      deletes.push(key);
      puts.delete(key);
    },
    buildKey: (taskId, filename) => `tasks/${taskId}/${filename}-${puts.size}`,
    async download(url, size) {
      if (size != null && size > 50 * 1024 * 1024) return null;
      return { bytes: Buffer.from(`bytes-of-${url}`), contentType: 'image/png' };
    },
  };
  return { storage, puts, deletes };
}

async function kaitenTask(projectId: string, creatorId: string, cardId: number) {
  const t = await makeTask({ projectId, creatorId });
  await prisma.task.update({ where: { id: t.id }, data: { externalSource: 'kaiten', externalId: String(cardId) } });
  return t;
}

describe('syncKaitenFiles', () => {
  it('downloads card files into attachments; idempotent; skips deleted', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const task = await kaitenTask(project.id, owner.id, 700);
    const { storage, puts } = memStorage();

    const client = fakeClient({
      700: [
        file({ id: 11, name: 'a.png' }),
        file({ id: 12, name: 'b.pdf', mime_type: 'application/pdf' }),
        file({ id: 13, name: 'gone.png', deleted: true }),
      ],
    });

    const res = await syncKaitenFiles(client, project.id, { storage });
    expect(res.files).toBe(2);
    expect(puts.size).toBe(2);

    const atts = await prisma.attachment.findMany({ where: { taskId: task.id }, orderBy: { externalId: 'asc' } });
    expect(atts).toHaveLength(2);
    expect(atts.map((a) => a.filename).sort()).toEqual(['a.png', 'b.pdf']);
    expect(atts[0].externalSource).toBe('kaiten');
    expect(atts[0].sizeBytes).toBeGreaterThan(0);

    // Idempotent: second run downloads nothing new.
    const res2 = await syncKaitenFiles(client, project.id, { storage });
    expect(res2.files).toBe(0);
    expect(await prisma.attachment.count({ where: { taskId: task.id } })).toBe(2);
  });

  it('delete-reconciles an attachment removed upstream (and deletes the object)', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const task = await kaitenTask(project.id, owner.id, 701);
    const { storage, deletes } = memStorage();

    await syncKaitenFiles(fakeClient({ 701: [file({ id: 21, name: 'keep.png' }), file({ id: 22, name: 'drop.png' })] }), project.id, { storage });
    expect(await prisma.attachment.count({ where: { taskId: task.id } })).toBe(2);

    // Upstream now only has file 21.
    const res = await syncKaitenFiles(fakeClient({ 701: [file({ id: 21, name: 'keep.png' })] }), project.id, { storage });
    expect(res.deleted).toBe(1);
    const atts = await prisma.attachment.findMany({ where: { taskId: task.id } });
    expect(atts).toHaveLength(1);
    expect(atts[0].externalId).toContain(':21');
    expect(deletes.length).toBe(1);
  });

  it('skips a file that exceeds the size cap', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const task = await kaitenTask(project.id, owner.id, 702);
    const { storage } = memStorage();

    const res = await syncKaitenFiles(
      fakeClient({ 702: [file({ id: 31, name: 'huge.bin', size: 60 * 1024 * 1024 })] }),
      project.id,
      { storage },
    );
    expect(res.files).toBe(0);
    expect(await prisma.attachment.count({ where: { taskId: task.id } })).toBe(0);
  });
});
