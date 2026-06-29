import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import { runKaitenSync, KAITEN_SOURCE, type KaitenCard, type KaitenComment } from '@giper/integrations/kaiten';
import type { KaitenClient } from '@giper/integrations/kaiten';
import { makeUser, makeProject, makeTask } from './helpers/factories';

/** A KaitenClient stand-in that yields canned card pages (no network). Live cards
 *  for condition 1 (the default), archived cards for condition 2 (reconcile).
 *  commentsByCard maps a card id to its canned comments. */
function fakeClient(
  livePages: KaitenCard[][],
  archivedPages: KaitenCard[][] = [],
  commentsByCard: Record<number, KaitenComment[]> = {},
): KaitenClient {
  return {
    async *listCardsPaged(opts: { condition?: number }) {
      const pages = opts?.condition === 2 ? archivedPages : livePages;
      for (const page of pages) yield page;
    },
    async listCardComments(cardId: number) {
      return commentsByCard[cardId] ?? [];
    },
  } as unknown as KaitenClient;
}

function comment(over: Partial<KaitenComment> & { id: number; text: string }): KaitenComment {
  return {
    author_id: 1,
    author: { full_name: 'Иван' },
    created: '2026-06-01T00:00:00Z',
    updated: '2026-06-01T00:00:00Z',
    deleted: false,
    ...over,
  };
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
    comments_total: 0,
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

    // The inbound sync dual-writes the dynamic-status FKs alongside the enum,
    // and seeds the INTERNAL (board) status from the mapped Kaiten state so an
    // imported card lands in its matching column, not always Бэклог.
    const t101fk = imported.find((t) => t.externalId === '101')!;
    expect(t101fk.statusId).toBe(`st_${project.id}_IN_PROGRESS`); // mirror FK from Kaiten state
    expect(t101fk.internalStatus).toBe('IN_PROGRESS'); // internal seeded from mirror, not BACKLOG
    expect(t101fk.internalStatusId).toBe(`st_${project.id}_IN_PROGRESS`);
    expect(t101fk.columnId).toBeNull(); // makeProject seeds statuses, not columns → board fallback
    expect(imported.find((t) => t.externalId === '102')?.statusId).toBe(`st_${project.id}_DONE`);

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

  it('records a medium-confidence match as a pending suggestion (no auto-link); reject suppresses re-proposal', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const twin = await makeTask({ projectId: project.id, creatorId: owner.id, title: 'Обновить прайс-лист поставщика' });
    await prisma.task.update({ where: { id: twin.id }, data: { externalSource: 'bitrix24', externalId: 'B-PL' } });

    const res = await runKaitenSync(
      prisma,
      fakeClient([[card({ id: 501, title: 'Обновить прайс-лист' })]]),
      { projectId: project.id, boardId: 7 },
    );
    expect(res.autoLinked).toBe(0);
    expect(res.suggestions).toBe(1);

    const sugg = await prisma.kaitenMatchSuggestion.findMany({ where: { projectId: project.id, status: 'pending' } });
    expect(sugg).toHaveLength(1);
    expect(sugg[0].bitrixTaskId).toBe(twin.id);
    expect(sugg[0].score).toBeGreaterThan(0.55);
    expect(sugg[0].score).toBeLessThan(0.9);

    const kt = await prisma.task.findFirst({
      where: { projectId: project.id, externalSource: 'kaiten', externalId: '501' },
      select: { id: true },
    });
    expect(await prisma.taskDependency.count({ where: { fromTaskId: kt!.id } })).toBe(0);

    // Rejecting the pair suppresses it on the next sync.
    await prisma.kaitenMatchSuggestion.update({ where: { id: sugg[0].id }, data: { status: 'rejected' } });
    const res2 = await runKaitenSync(
      prisma,
      fakeClient([[card({ id: 501, title: 'Обновить прайс-лист' })]]),
      { projectId: project.id, boardId: 7 },
    );
    expect(res2.suggestions).toBe(0);
    expect(await prisma.kaitenMatchSuggestion.count({ where: { projectId: project.id, status: 'pending' } })).toBe(0);
  });

  it('does not propose a Bitrix task that already has a pending suggestion to a second card (cross-run)', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const twin = await makeTask({ projectId: project.id, creatorId: owner.id, title: 'Обновить прайс-лист поставщика' });
    await prisma.task.update({ where: { id: twin.id }, data: { externalSource: 'bitrix24', externalId: 'B-PL2' } });

    // Run 1: card 601 proposes the twin (pending).
    const r1 = await runKaitenSync(
      prisma,
      fakeClient([[card({ id: 601, title: 'Обновить прайс-лист' })]]),
      { projectId: project.id, boardId: 7 },
    );
    expect(r1.suggestions).toBe(1);

    // Run 2: a different card with the same fuzzy title must NOT double-propose the twin.
    const r2 = await runKaitenSync(
      prisma,
      fakeClient([[card({ id: 602, title: 'Обновить прайс-лист' })]]),
      { projectId: project.id, boardId: 7 },
    );
    expect(r2.suggestions).toBe(0);
    expect(await prisma.kaitenMatchSuggestion.count({ where: { bitrixTaskId: twin.id, status: 'pending' } })).toBe(1);
  });

  it('reconcileArchived reflects an archived card final state onto the existing task (no new tasks)', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });

    // Imported live, in progress.
    await runKaitenSync(
      prisma,
      fakeClient([[card({ id: 700, title: 'Релиз 3.0', state: 2 })]]),
      { projectId: project.id, boardId: 7 },
    );
    let t = await prisma.task.findFirstOrThrow({
      where: { projectId: project.id, externalSource: 'kaiten', externalId: '700' },
    });
    expect(t.status).toBe('IN_PROGRESS');

    // Next sync: card archived as done (live board empty, appears under condition=2).
    const res = await runKaitenSync(
      prisma,
      fakeClient([], [[card({ id: 700, title: 'Релиз 3.0', state: 3, condition: 2, archived: true })]]),
      { projectId: project.id, boardId: 7, reconcileArchived: true },
    );
    expect(res.reconciled).toBe(1);
    t = await prisma.task.findFirstOrThrow({
      where: { projectId: project.id, externalSource: 'kaiten', externalId: '700' },
    });
    expect(t.status).toBe('DONE');

    // An archived card we never imported is NOT created.
    const res2 = await runKaitenSync(
      prisma,
      fakeClient([], [[card({ id: 999, title: 'Никогда не было', state: 1, condition: 2, archived: true })]]),
      { projectId: project.id, boardId: 7, reconcileArchived: true },
    );
    expect(res2.reconciled).toBe(0);
    expect(
      await prisma.task.count({ where: { projectId: project.id, externalSource: 'kaiten', externalId: '999' } }),
    ).toBe(0);
  });

  it('syncComments mirrors card comments (author prefixed, bot-authored, idempotent, skips empty/deleted)', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });

    const cards = [[card({ id: 800, title: 'Карточка с комментами', comments_total: 3 })]];
    const comments = {
      800: [
        comment({ id: 9001, text: 'Первый коммент', author: { full_name: 'Пётр' } }),
        comment({ id: 9002, text: 'Удалённый', deleted: true }),
        comment({ id: 9003, text: '   ', author: { full_name: 'Аноним' } }), // empty after trim
      ],
    };

    const res = await runKaitenSync(prisma, fakeClient(cards, [], comments), {
      projectId: project.id,
      boardId: 7,
      syncComments: true,
    });
    expect(res.comments).toBe(1); // only the one real, non-empty comment

    const t = await prisma.task.findFirstOrThrow({
      where: { projectId: project.id, externalSource: 'kaiten', externalId: '800' },
      select: { id: true },
    });
    const rows = await prisma.comment.findMany({ where: { taskId: t.id }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toContain('Пётр');
    expect(rows[0].body).toContain('Первый коммент');
    expect(rows[0].externalSource).toBe('kaiten');

    // Idempotent: re-sync doesn't duplicate.
    const res2 = await runKaitenSync(prisma, fakeClient(cards, [], comments), {
      projectId: project.id,
      boardId: 7,
      syncComments: true,
    });
    expect(res2.comments).toBe(1);
    expect(await prisma.comment.count({ where: { taskId: t.id } })).toBe(1);

    // Without syncComments, no fetch/no rows added.
    const noComments = [[card({ id: 801, title: 'Без синка комментов', comments_total: 5 })]];
    await runKaitenSync(prisma, fakeClient(noComments, [], { 801: [comment({ id: 9100, text: 'x' })] }), {
      projectId: project.id,
      boardId: 7,
    });
    const t2 = await prisma.task.findFirstOrThrow({
      where: { projectId: project.id, externalSource: 'kaiten', externalId: '801' },
      select: { id: true },
    });
    expect(await prisma.comment.count({ where: { taskId: t2.id } })).toBe(0);
  });

  it('delete-reconciles a Kaiten comment that disappears upstream', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });

    await runKaitenSync(
      prisma,
      fakeClient([[card({ id: 820, title: 'C', comments_total: 2 })]], [], {
        820: [comment({ id: 1, text: 'остаётся' }), comment({ id: 2, text: 'уйдёт' })],
      }),
      { projectId: project.id, boardId: 7, syncComments: true },
    );
    const t = await prisma.task.findFirstOrThrow({
      where: { projectId: project.id, externalSource: 'kaiten', externalId: '820' },
      select: { id: true },
    });
    expect(await prisma.comment.count({ where: { taskId: t.id } })).toBe(2);

    // Upstream now only has comment 1 (comment 2 deleted in Kaiten).
    await runKaitenSync(
      prisma,
      fakeClient([[card({ id: 820, title: 'C', comments_total: 1 })]], [], {
        820: [comment({ id: 1, text: 'остаётся' })],
      }),
      { projectId: project.id, boardId: 7, syncComments: true },
    );
    const rows = await prisma.comment.findMany({ where: { taskId: t.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].externalId).toContain(':1');
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

  it('self-heals a project with no statuses — seeds them before the dual-write (S5)', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    // Simulate a Bitrix project created between the S1 backfill and the S5 deploy:
    // no dynamic statuses, so a dual-write would otherwise dangle the FK.
    await prisma.status.deleteMany({ where: { projectId: project.id } });
    expect(await prisma.status.count({ where: { projectId: project.id } })).toBe(0);

    const res = await runKaitenSync(
      prisma,
      fakeClient([[card({ id: 201, title: 'Карточка', state: 2 })]]),
      { projectId: project.id, boardId: 1 },
    );
    expect(res.ok).toBe(true);
    expect(res.created).toBe(1);
    // The sync seeded the 8 statuses, so the dual-write FK resolves.
    expect(await prisma.status.count({ where: { projectId: project.id } })).toBe(8);
    const t = await prisma.task.findFirstOrThrow({ where: { projectId: project.id, externalId: '201' } });
    expect(t.statusId).toBe(`st_${project.id}_IN_PROGRESS`);
    // internal status is seeded from the mirror status on import (not BACKLOG).
    expect(t.internalStatusId).toBe(`st_${project.id}_IN_PROGRESS`);
  });
});
