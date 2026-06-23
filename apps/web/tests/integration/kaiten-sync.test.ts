import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import { runKaitenSync, KAITEN_SOURCE, type KaitenCard } from '@giper/integrations/kaiten';
import type { KaitenClient } from '@giper/integrations/kaiten';
import { makeUser, makeProject, makeTask } from './helpers/factories';

/** A KaitenClient stand-in that yields canned card pages (no network). */
function fakeClient(pages: KaitenCard[][]): KaitenClient {
  return {
    // eslint-disable-next-line require-yield
    async *listCardsPaged() {
      for (const page of pages) yield page;
    },
  } as unknown as KaitenClient;
}

function card(over: Partial<KaitenCard> & { id: number; title: string }): KaitenCard {
  return {
    state: 1,
    archived: false,
    condition: 1,
    board_id: 7,
    column_id: 1,
    lane_id: null,
    owner_id: null,
    due_date: null,
    external_id: null,
    created: '2026-06-01T00:00:00Z',
    updated: '2026-06-01T00:00:00Z',
    description: '',
    ...over,
  };
}

describe('runKaitenSync', () => {
  it('imports cards as tasks, maps state→status, and auto-links a Bitrix twin as DUPLICATES', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });

    // A pre-existing Bitrix-mirrored task that one of the cards duplicates.
    const bitrixTwin = await makeTask({ projectId: project.id, creatorId: owner.id, title: 'Починить логин на проде' });
    await prisma.task.update({
      where: { id: bitrixTwin.id },
      data: { externalSource: 'bitrix24', externalId: 'B-1' },
    });

    const result = await runKaitenSync(
      prisma,
      fakeClient([
        [
          card({ id: 101, title: 'PROJ-3: Починить логин на проде', state: 2 }),
          card({ id: 102, title: 'Совершенно другая задача дизайна', state: 3 }),
        ],
      ]),
      { projectId: project.id, boardId: 7 },
    );

    expect(result.cards).toBe(2);
    expect(result.created).toBe(2);
    expect(result.autoLinked).toBe(1);
    expect(result.ok).toBe(true);

    const imported = await prisma.task.findMany({
      where: { projectId: project.id, externalSource: KAITEN_SOURCE },
      orderBy: { externalId: 'asc' },
    });
    expect(imported.map((t) => t.externalId)).toEqual(['101', '102']);
    expect(imported.find((t) => t.externalId === '101')?.status).toBe('IN_PROGRESS');
    expect(imported.find((t) => t.externalId === '102')?.status).toBe('DONE');

    // The matching card is linked to the Bitrix twin as a duplicate.
    const card101 = imported.find((t) => t.externalId === '101')!;
    const link = await prisma.taskDependency.findFirst({
      where: { fromTaskId: card101.id, linkType: 'DUPLICATES' },
    });
    expect(link?.toTaskId).toBe(bitrixTwin.id);

    // The unrelated card got no link.
    const card102 = imported.find((t) => t.externalId === '102')!;
    expect(await prisma.taskDependency.count({ where: { fromTaskId: card102.id } })).toBe(0);
  });

  it('is idempotent — a second run updates in place without duplicating tasks or links', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const twin = await makeTask({ projectId: project.id, creatorId: owner.id, title: 'Обновить прайс-лист' });
    await prisma.task.update({ where: { id: twin.id }, data: { externalSource: 'bitrix24', externalId: 'B-9' } });

    const pages = [[card({ id: 200, title: 'Обновить прайс-лист', state: 1 })]];
    await runKaitenSync(prisma, fakeClient(pages), { projectId: project.id, boardId: 7 });

    // Card now moved to done upstream.
    const second = await runKaitenSync(
      prisma,
      fakeClient([[card({ id: 200, title: 'Обновить прайс-лист', state: 3 })]]),
      { projectId: project.id, boardId: 7 },
    );
    expect(second.created).toBe(0);
    expect(second.updated).toBe(1);
    expect(second.autoLinked).toBe(0); // already linked → not re-linked

    const tasks = await prisma.task.findMany({
      where: { projectId: project.id, externalSource: KAITEN_SOURCE, externalId: '200' },
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe('DONE');

    const links = await prisma.taskDependency.count({
      where: { fromTaskId: tasks[0].id, linkType: 'DUPLICATES' },
    });
    expect(links).toBe(1);
  });

  it('org scope matches a Bitrix twin in a DIFFERENT project; project scope does not', async () => {
    const owner = await makeUser();
    const importProject = await makeProject({ ownerId: owner.id });
    const otherProject = await makeProject({ ownerId: owner.id });

    // The twin lives in a sibling project (the remote board spans several).
    const twin = await makeTask({ projectId: otherProject.id, creatorId: owner.id, title: 'Интеграция с Uzum' });
    await prisma.task.update({ where: { id: twin.id }, data: { externalSource: 'bitrix24', externalId: 'B-UZ' } });

    // project scope: no candidates in importProject → no link.
    const proj = await runKaitenSync(
      prisma,
      fakeClient([[card({ id: 401, title: 'Интеграция с UZUM' })]]),
      { projectId: importProject.id, boardId: 7, matchScope: 'project' },
    );
    expect(proj.autoLinked).toBe(0);

    // org scope: finds the twin in the sibling project and links it.
    const org = await runKaitenSync(
      prisma,
      fakeClient([[card({ id: 402, title: 'Интеграция с UZUM' })]]),
      { projectId: importProject.id, boardId: 7, matchScope: 'org' },
    );
    expect(org.autoLinked).toBe(1);
    const linked = await prisma.taskDependency.findFirst({ where: { toTaskId: twin.id, linkType: 'DUPLICATES' } });
    expect(linked).not.toBeNull();
  });

  it('does not let two cards both claim the same Bitrix twin in one run', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const twin = await makeTask({ projectId: project.id, creatorId: owner.id, title: 'Выкатить релиз 2.0' });
    await prisma.task.update({ where: { id: twin.id }, data: { externalSource: 'bitrix24', externalId: 'B-7' } });

    const result = await runKaitenSync(
      prisma,
      fakeClient([
        [
          card({ id: 301, title: 'Выкатить релиз 2.0' }),
          card({ id: 302, title: 'Выкатить релиз 2.0' }),
        ],
      ]),
      { projectId: project.id, boardId: 7 },
    );

    expect(result.created).toBe(2);
    // Only one of the two identical cards may link to the single twin.
    expect(result.autoLinked).toBe(1);
    expect(await prisma.taskDependency.count({ where: { toTaskId: twin.id, linkType: 'DUPLICATES' } })).toBe(1);
  });
});
