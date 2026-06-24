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
  it('imports spaces + articles (article-typed tree), rebuilds hierarchy, converts content', async () => {
    const res = await runTeamlySync(prisma, mockClient());
    expect(res.ok).toBe(true);
    expect(res.spaces).toBe(1);
    expect(res.articles).toBe(2);
    expect(res.tables).toBe(0); // an article-typed tree is NOT classified as a table

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

describe('runTeamlySync — smart tables (T3)', () => {
  // A TEAMLY smart table is a space with schemaProperties (columns); its
  // inlineDatabaseArticle items are the rows (article.properties.properties =
  // cell values keyed by property code).
  function mockTableClient(over?: { omitRow?: string; hiddenRow?: string }): TeamlyClient {
    const space = {
      id: 'tbl1',
      title: 'Контакты',
      description: null,
      main_article: null,
      schemaProperties: [
        { propertyId: 'p1', code: 'title', name: 'Имя', type: 'title', sort: 0 },
        { propertyId: 'p2', code: 'c_email', name: 'Email', type: 'text', sort: 1 },
        { propertyId: 'p3', code: 'c_status', name: 'Статус', type: 'select', sort: 2, options: [{ id: 'o1', text: 'Активен' }, { id: 'o2', text: 'Архив' }] },
        { propertyId: 'p4', code: 'c_count', name: 'Кол-во', type: 'number', sort: 3 },
        { propertyId: 'pSys', code: 'author', name: 'Автор', type: 'person', sort: 9 },
      ],
    };
    const tree = [
      { id: 'row1', title: 'Иван', parentSpaceId: 'tbl1', type: 'inlineDatabaseArticle', isArchived: false, createdAt: '2025-01-10 10:00:00', updatedAt: '2025-01-10 10:00:00', publishedAt: null, createdBy: null },
      { id: 'row2', title: 'Пётр', parentSpaceId: 'tbl1', type: 'inlineDatabaseArticle', isArchived: false, createdAt: '2025-01-10 10:00:00', updatedAt: '2025-01-10 10:00:00', publishedAt: null, createdBy: null },
    ].filter((r) => r.id !== over?.omitRow);
    const rows: Record<string, unknown> = {
      row1: { id: 'row1', title: 'Иван', properties: { properties: { c_email: 'ivan@x.ru', c_status: 'o1', c_count: 5 } }, editorContentObject: null, author: null, breadcrumbs: [], updated_at: null, icon: null, archived: false, is_hidden: false, created_at: null },
      row2: { id: 'row2', title: 'Пётр', properties: { properties: { c_email: 'petr@x.ru', c_status: 'o2', c_count: 3 } }, editorContentObject: null, author: null, breadcrumbs: [], updated_at: null, icon: null, archived: false, is_hidden: false, created_at: null },
    };
    return {
      listSpaces: async () => ({ items: [space], lastPage: 1 }),
      getSpaceTree: async () => ({ items: tree, lastPage: 1 }),
      getArticle: async (id: string) => {
        const r = rows[id];
        if (!r) return null;
        return id === over?.hiddenRow ? { ...(r as object), is_hidden: true } : r;
      },
    } as unknown as TeamlyClient;
  }

  it('imports a TEAMLY table as a KnowledgeTable with typed columns + rows', async () => {
    const res = await runTeamlySync(prisma, mockTableClient());
    expect(res.ok).toBe(true);
    expect(res.tables).toBe(1);
    expect(res.tableRows).toBe(2);
    expect(res.articles).toBe(0); // a table-space yields no KB articles

    const space = await prisma.knowledgeSpace.findFirstOrThrow({ where: { externalSource: 'teamly', externalId: 'tbl1' } });
    const table = await prisma.knowledgeTable.findFirstOrThrow({
      where: { externalSource: 'teamly', externalId: 'tbl1' },
      include: { columns: { orderBy: { order: 'asc' } }, rows: { orderBy: { order: 'asc' } } },
    });
    expect(table.spaceId).toBe(space.id);
    expect(table.name).toBe('Контакты');

    // columns: system 'author' dropped → 4 typed columns in sort order
    expect(table.columns.map((c) => c.name)).toEqual(['Имя', 'Email', 'Статус', 'Кол-во']);
    expect(table.columns.map((c) => c.type)).toEqual(['TEXT', 'TEXT', 'SELECT', 'NUMBER']);
    expect(table.columns.find((c) => c.name === 'Статус')!.options).toEqual(['Активен', 'Архив']);

    // rows: title from article.title; select id→label; number stringified
    const cell = (r: (typeof table.rows)[number], name: string) =>
      (r.values as Record<string, string>)[table.columns.find((c) => c.name === name)!.id];
    const r1 = table.rows.find((r) => r.externalId === 'tbl1::row1')!;
    expect(cell(r1, 'Имя')).toBe('Иван');
    expect(cell(r1, 'Email')).toBe('ivan@x.ru');
    expect(cell(r1, 'Статус')).toBe('Активен');
    expect(cell(r1, 'Кол-во')).toBe('5');
  });

  it('is idempotent — re-sync keeps one table + stable column ids', async () => {
    await runTeamlySync(prisma, mockTableClient());
    const before = await prisma.knowledgeTableColumn.findMany({ where: { externalSource: 'teamly' }, select: { id: true } });
    await runTeamlySync(prisma, mockTableClient());
    expect(await prisma.knowledgeTable.count({ where: { externalSource: 'teamly' } })).toBe(1);
    expect(await prisma.knowledgeTableRow.count({ where: { externalSource: 'teamly' } })).toBe(2);
    const after = await prisma.knowledgeTableColumn.findMany({ where: { externalSource: 'teamly' }, select: { id: true } });
    expect(after.map((c) => c.id).sort()).toEqual(before.map((c) => c.id).sort()); // stable
  });

  it('prunes a row removed from the source table', async () => {
    await runTeamlySync(prisma, mockTableClient());
    expect(await prisma.knowledgeTableRow.count({ where: { externalSource: 'teamly' } })).toBe(2);
    await runTeamlySync(prisma, mockTableClient({ omitRow: 'row2' }));
    expect(await prisma.knowledgeTableRow.count({ where: { externalSource: 'teamly' } })).toBe(1);
    expect(await prisma.knowledgeTableRow.count({ where: { externalSource: 'teamly', externalId: 'tbl1::row1' } })).toBe(1);
  });

  it('does not mirror a source-hidden row into the public table', async () => {
    const res = await runTeamlySync(prisma, mockTableClient({ hiddenRow: 'row2' }));
    expect(res.tableRows).toBe(1); // only the visible row1
    expect(await prisma.knowledgeTableRow.count({ where: { externalSource: 'teamly' } })).toBe(1);
    expect(await prisma.knowledgeTableRow.count({ where: { externalSource: 'teamly', externalId: 'tbl1::row2' } })).toBe(0);
  });

  it('does NOT classify an article space as a table even with user schemaProperties (prod-bug guard)', async () => {
    // The prod regression: TEAMLY returns user article-properties on ordinary
    // spaces too. Classification MUST be by tree item type (article), not by
    // schemaProperties — otherwise every documentation space becomes a "table".
    const client = {
      listSpaces: async () => ({
        items: [{
          id: 'docs1', title: 'Документация', description: null, main_article: null,
          schemaProperties: [
            { propertyId: 'p1', code: 'title', name: 'Заголовок', type: 'title' },
            { propertyId: 'p2', code: 'c_block', name: 'Блокирующие', type: 'text' },
            { propertyId: 'p3', code: 'c_date', name: 'Дата', type: 'date' },
          ],
        }],
        lastPage: 1,
      }),
      getSpaceTree: async () => ({
        items: [
          { id: 'a1', title: 'Статья 1', parentSpaceId: 'docs1', type: 'article', isArchived: false, createdAt: '2025-01-10 10:00:00', updatedAt: '2025-01-10 10:00:00', publishedAt: '2025-01-10 10:00:00', createdBy: null },
          { id: 'a2', title: 'Статья 2', parentSpaceId: 'docs1', type: 'article', isArchived: false, createdAt: '2025-01-10 10:00:00', updatedAt: '2025-01-10 10:00:00', publishedAt: '2025-01-10 10:00:00', createdBy: null },
        ],
        lastPage: 1,
      }),
      getArticle: async (id: string) => ({
        id, title: id === 'a1' ? 'Статья 1' : 'Статья 2', editorContentObject: null,
        author: null, breadcrumbs: [], updated_at: null, icon: null, archived: false, is_hidden: false, created_at: null,
      }),
    } as unknown as TeamlyClient;
    const res = await runTeamlySync(prisma, client);
    expect(res.ok).toBe(true);
    expect(res.tables).toBe(0); // article-typed tree → article space, NOT a table
    expect(res.articles).toBe(2);
    expect(await prisma.knowledgeTable.count({ where: { externalSource: 'teamly', externalId: 'docs1' } })).toBe(0);
    expect(await prisma.knowledgeArticle.count({ where: { externalSource: 'teamly', externalId: { in: ['a1', 'a2'] } } })).toBe(2);
  });
});
