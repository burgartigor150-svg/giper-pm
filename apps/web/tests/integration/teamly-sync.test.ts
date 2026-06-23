import { describe, it, expect } from 'vitest';

/**
 * Integration tests for the TEAMLY → KB sync (T1): a mock TEAMLY client feeds
 * sample spaces/tree/articles; the sync upserts real rows. Covers idempotent
 * re-run, hierarchy from breadcrumbs, ProseMirror→markdown content, and the
 * incremental skip-unchanged path.
 *
 * Source: packages/integrations/src/teamly/runSync.ts
 */

import { prisma } from '@giper/db';
import { runTeamlySync } from '@giper/integrations/teamly';
import type { TeamlyClient } from '@giper/integrations/teamly';

const pmDoc = (heading: string, para: string) =>
  JSON.stringify({
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: heading }] },
      { type: 'paragraph', content: [{ type: 'text', text: para }] },
    ],
  });

type Article = {
  id: string;
  title: string;
  editorContentObject: { content: string; versionAt: number } | null;
  author: { id: string; full_name: string | null; external_id: string | null } | null;
  breadcrumbs: { sourceId: string; sourceType: string; title: string }[];
  updated_at: number | null;
  icon: null;
  archived: false;
  is_hidden: false;
  created_at: null;
};

function mockClient(over?: { treeUpdatedAt?: string; hiddenIds?: string[]; omitIds?: string[]; errorId?: string }): TeamlyClient {
  const hidden = new Set(over?.hiddenIds ?? []);
  const omit = new Set(over?.omitIds ?? []);
  const updatedAt = over?.treeUpdatedAt ?? '2025-01-11 10:00:00';
  const tree = [
    { id: 'ta1', title: 'Корень', parentSpaceId: 'tsp1', type: 'article', isArchived: false, createdAt: '2025-01-10 10:00:00', updatedAt: '2025-01-10 10:00:00', publishedAt: updatedAt, createdBy: null },
    { id: 'ta2', title: 'Дочерняя', parentSpaceId: 'tsp1', type: 'article', isArchived: false, createdAt: '2025-01-11 10:00:00', updatedAt, publishedAt: updatedAt, createdBy: null },
    { id: 'trow', title: 'Строка таблицы', parentSpaceId: 'tsp1', type: 'inlineDatabaseArticle', isArchived: false, createdAt: '2025-01-11 10:00:00', updatedAt, publishedAt: updatedAt, createdBy: null },
  ];
  const articles: Record<string, Article> = {
    ta1: {
      id: 'ta1', title: 'Корень', editorContentObject: { content: pmDoc('Корень', 'Тело корневой статьи.'), versionAt: 1 },
      author: { id: 'u1', full_name: 'Автор', external_id: null }, breadcrumbs: [{ sourceId: 'ta1', sourceType: 'article', title: 'Корень' }],
      updated_at: null, icon: null, archived: false, is_hidden: false, created_at: null,
    },
    ta2: {
      id: 'ta2', title: 'Дочерняя', editorContentObject: { content: pmDoc('Дочерняя', 'Тело дочерней.'), versionAt: 1 },
      author: null, breadcrumbs: [{ sourceId: 'ta1', sourceType: 'article', title: 'Корень' }, { sourceId: 'ta2', sourceType: 'article', title: 'Дочерняя' }],
      updated_at: null, icon: null, archived: false, is_hidden: false, created_at: null,
    },
  };
  return {
    listSpaces: async () => ({ items: [{ id: 'tsp1', title: 'Пространство A', description: 'описание', main_article: null }], lastPage: 1 }),
    getSpaceTree: async () => ({ items: tree.filter((i) => !omit.has(i.id)), lastPage: 1 }),
    getArticle: async (id: string) => {
      if (over?.errorId === id) throw new Error('boom');
      const a = articles[id];
      if (!a) return null;
      return { ...a, is_hidden: hidden.has(id) } as Article;
    },
  } as unknown as TeamlyClient;
}

describe('runTeamlySync', () => {
  it('imports spaces + articles, rebuilds hierarchy, converts content, and skips table rows', async () => {
    const res = await runTeamlySync(prisma, mockClient());
    expect(res.ok).toBe(true);
    expect(res.spaces).toBe(1);
    expect(res.articles).toBe(2); // inlineDatabaseArticle skipped

    const space = await prisma.knowledgeSpace.findFirstOrThrow({ where: { externalSource: 'teamly', externalId: 'tsp1' } });
    expect(space.name).toBe('Пространство A');

    const root = await prisma.knowledgeArticle.findFirstOrThrow({ where: { externalSource: 'teamly', externalId: 'ta1' } });
    const child = await prisma.knowledgeArticle.findFirstOrThrow({ where: { externalSource: 'teamly', externalId: 'ta2' } });
    expect(root.spaceId).toBe(space.id);
    expect(root.content).toContain('# Корень');
    expect(root.content).toContain('Тело корневой статьи.');
    expect(child.parentId).toBe(root.id); // hierarchy from breadcrumbs
    expect(child.parentId).not.toBeNull();
  });

  it('is idempotent — a second run updates in place, no duplicates', async () => {
    await runTeamlySync(prisma, mockClient());
    await runTeamlySync(prisma, mockClient());
    expect(await prisma.knowledgeSpace.count({ where: { externalSource: 'teamly' } })).toBe(1);
    expect(await prisma.knowledgeArticle.count({ where: { externalSource: 'teamly' } })).toBe(2);
  });

  it('incremental mode skips articles whose updatedAt is unchanged', async () => {
    await runTeamlySync(prisma, mockClient());
    const res = await runTeamlySync(prisma, mockClient(), { incremental: true });
    expect(res.skipped).toBeGreaterThanOrEqual(2);
    expect(res.articles).toBe(0);
  });

  it('re-imports an article when its updatedAt advances', async () => {
    await runTeamlySync(prisma, mockClient());
    const res = await runTeamlySync(prisma, mockClient({ treeUpdatedAt: '2025-02-01 10:00:00' }), { incremental: true });
    expect(res.articles).toBeGreaterThanOrEqual(1);
  });

  it('skips source-hidden articles (not imported)', async () => {
    const res = await runTeamlySync(prisma, mockClient({ hiddenIds: ['ta2'] }));
    expect(res.articles).toBe(1); // only ta1
    expect(await prisma.knowledgeArticle.count({ where: { externalSource: 'teamly', externalId: 'ta2' } })).toBe(0);
  });

  it('reconcile soft-archives an article removed from TEAMLY (DRAFT)', async () => {
    await runTeamlySync(prisma, mockClient());
    // ta2 disappears from the source tree → reconcile should DRAFT it
    const res = await runTeamlySync(prisma, mockClient({ omitIds: ['ta2'] }), { reconcile: true });
    expect(res.archived).toBeGreaterThanOrEqual(1);
    const ta2 = await prisma.knowledgeArticle.findFirstOrThrow({ where: { externalSource: 'teamly', externalId: 'ta2' } });
    expect(ta2.status).toBe('DRAFT');
    const ta1 = await prisma.knowledgeArticle.findFirstOrThrow({ where: { externalSource: 'teamly', externalId: 'ta1' } });
    expect(ta1.status).toBe('PUBLISHED'); // still present → untouched
  });

  it('reconcile does NOT archive when the run had errors (partial run guard)', async () => {
    await runTeamlySync(prisma, mockClient());
    // ta2 omitted AND ta1 errors → run has errors → reconcile must NOT fire
    const res = await runTeamlySync(prisma, mockClient({ omitIds: ['ta2'], errorId: 'ta1' }), { reconcile: true });
    expect(res.errors.length).toBeGreaterThanOrEqual(1);
    expect(res.archived).toBe(0);
    const ta2 = await prisma.knowledgeArticle.findFirstOrThrow({ where: { externalSource: 'teamly', externalId: 'ta2' } });
    expect(ta2.status).toBe('PUBLISHED'); // NOT archived despite being absent
  });

  it('reconcile does NOT archive a space whose tree came back EMPTY (silent-empty guard)', async () => {
    await runTeamlySync(prisma, mockClient()); // ta1, ta2 PUBLISHED
    // a glitchy 200 returns no articles for the space → must NOT DRAFT its content
    const res = await runTeamlySync(prisma, mockClient({ omitIds: ['ta1', 'ta2'] }), { reconcile: true });
    expect(res.archived).toBe(0);
    const ta1 = await prisma.knowledgeArticle.findFirstOrThrow({ where: { externalSource: 'teamly', externalId: 'ta1' } });
    const ta2 = await prisma.knowledgeArticle.findFirstOrThrow({ where: { externalSource: 'teamly', externalId: 'ta2' } });
    expect(ta1.status).toBe('PUBLISHED');
    expect(ta2.status).toBe('PUBLISHED');
  });

  it('reconcile self-heals a falsely-DRAFTed article on a later run (even incremental)', async () => {
    await runTeamlySync(prisma, mockClient()); // import
    await runTeamlySync(prisma, mockClient({ omitIds: ['ta2'] }), { reconcile: true }); // ta2 → DRAFT
    expect((await prisma.knowledgeArticle.findFirstOrThrow({ where: { externalId: 'ta2' } })).status).toBe('DRAFT');
    // ta2 reappears; incremental would SKIP its content re-import, reconcile must restore
    await runTeamlySync(prisma, mockClient(), { incremental: true, reconcile: true });
    expect((await prisma.knowledgeArticle.findFirstOrThrow({ where: { externalId: 'ta2' } })).status).toBe('PUBLISHED');
  });
});
