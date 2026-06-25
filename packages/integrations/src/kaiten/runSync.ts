import type { PrismaClient } from '@giper/db';
import { KaitenClient } from './client';
import { getKaitenBotUserId } from './botUser';
import { prepareCandidates, bestMatchPrepared } from './match';
import { syncKaitenUsers, buildKaitenUserMap } from './syncUsers';
import { mirrorStatusFk, internalStatusFk, seedProjectStatuses } from '../status/statusSeed';

export const KAITEN_SOURCE = 'kaiten';

/** Safety valve: refuse to import an implausibly huge board in one run, and say so. */
const MAX_CARDS = 20_000;
/** Per-card comment cap — bounds DB writes for a pathological card. */
const MAX_COMMENTS_PER_CARD = 1_000;

export type RunKaitenSyncResult = {
  ok: boolean;
  cards: number;
  created: number;
  updated: number;
  autoLinked: number;
  suggestions: number;
  reconciled: number;
  comments: number;
  members: number;
  usersCreated: number;
  truncated: boolean;
  errors: string[];
  durationMs: number;
};

/** Which Bitrix-mirrored tasks a card is matched against for the DUPLICATES link.
 *  'project' = only the connected project's tasks; 'org' = every project's (the
 *  remote team's board often spans several Bitrix projects). */
export type KaitenMatchScope = 'project' | 'org';

export type RunKaitenSyncParams = {
  projectId: string;
  boardId: number;
  matchScope?: KaitenMatchScope;
  /** Also pull archived cards and reflect their final state onto existing tasks
   *  (done→DONE, otherwise→CANCELED). Used by the periodic cron. */
  reconcileArchived?: boolean;
  /** Mirror each card's Kaiten comments into the task's comments. */
  syncComments?: boolean;
  /** Create/link Kaiten users → set task assignee from the card owner, add
   *  involved people as project members, attribute comments to real users. */
  syncUsers?: boolean;
};
export type RunKaitenSyncOptions = { signal?: AbortSignal; now?: Date };

/** Kaiten card state → local TaskStatus. We only fetch live (on-board) cards. */
function stateToStatus(state: number, cardId: number): 'TODO' | 'IN_PROGRESS' | 'DONE' {
  if (state === 3) return 'DONE';
  if (state === 2) return 'IN_PROGRESS';
  if (state !== 1) {
    // Unknown/future state — surface it instead of silently bucketing as TODO.
    console.warn(`[kaiten] unknown card state ${state} (card ${cardId}) → defaulting to TODO`);
  }
  return 'TODO';
}

function isUniqueViolation(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { code?: string }).code === 'P2002';
}

/**
 * Import all live cards of one Kaiten board into a project as tasks (one-way,
 * full mirror — NO dedup), then fuzzy-match each card title against the
 * project's Bitrix-mirrored tasks and auto-link confident pairs as DUPLICATES.
 *
 * Idempotent: tasks are upserted by (projectId, externalSource='kaiten',
 * externalId=card.id); DUPLICATES links are created at most once per pair.
 * Concurrency-safe at the row level: a partial unique index on kaiten cards lets
 * a racing insert resolve to an update, and per-project task numbers are
 * allocated with retry on collision.
 */
export async function runKaitenSync(
  prisma: PrismaClient,
  client: KaitenClient,
  params: RunKaitenSyncParams,
  opts: RunKaitenSyncOptions = {},
): Promise<RunKaitenSyncResult> {
  const startedAt = opts.now ?? new Date();
  const errors: string[] = [];
  let cards = 0;
  let created = 0;
  let updated = 0;
  let autoLinked = 0;
  let suggestions = 0;
  let reconciled = 0;
  let commentsSynced = 0;
  let truncated = false;
  // Card ids seen in the live pass — the reconcile pass skips them so a card that
  // flips live→archived mid-run isn't wrongly CANCELED right after being imported.
  const seenLiveIds = new Set<string>();

  const botId = await getKaitenBotUserId(prisma);
  // S5 self-heal: the target project (an app- or Bitrix-created project) may
  // predate status seeding; ensure its dynamic statuses exist before the
  // dual-write so the status FKs resolve (idempotent).
  await seedProjectStatuses(prisma, params.projectId);

  // Build the Kaiten-user → local-user map (so card owners become assignees,
  // comment authors are attributed to real users, and involved people become
  // project members). Empty when syncUsers is off.
  let userMap = new Map<number, string>();
  let usersCreated = 0;
  if (params.syncUsers) {
    const ur = await syncKaitenUsers(prisma, client);
    usersCreated = ur.created;
    for (const e of ur.errors) errors.push(e);
    userMap = await buildKaitenUserMap(prisma);
  }
  // Local user ids to ensure as project members at the end of the run.
  const memberLocalIds = new Set<string>();

  // Bitrix-mirrored tasks are the match candidates — scoped to this project, or
  // org-wide when the board's twins live across several Bitrix projects.
  // Pre-normalize once so we don't re-normalize the same titles for every card
  // (O(n+m), not O(n*m)).
  const bitrixTasks = await prisma.task.findMany({
    where:
      params.matchScope === 'org'
        ? { externalSource: 'bitrix24' }
        : { projectId: params.projectId, externalSource: 'bitrix24' },
    select: { id: true, title: true },
  });
  const candidates = prepareCandidates(bitrixTasks);

  // Track which Bitrix task each Kaiten card links to so two cards don't both
  // claim the same twin. Seed it with twins already linked as DUPLICATES from a
  // prior run, so re-syncs (in any card order) never double-claim a twin.
  const claimedBitrixIds = new Set<string>();
  if (bitrixTasks.length > 0) {
    const bitrixIds = bitrixTasks.map((b) => b.id);
    const [existing, pending] = await Promise.all([
      prisma.taskDependency.findMany({
        where: { linkType: 'DUPLICATES', toTaskId: { in: bitrixIds } },
        select: { toTaskId: true },
      }),
      // A Bitrix task already awaiting review (pending suggestion) is claimed too,
      // so a re-sync (in any card order) never proposes the same twin to a 2nd card.
      prisma.kaitenMatchSuggestion.findMany({
        where: { status: 'pending', bitrixTaskId: { in: bitrixIds } },
        select: { bitrixTaskId: true },
      }),
    ]);
    for (const e of existing) claimedBitrixIds.add(e.toTaskId);
    for (const s of pending) claimedBitrixIds.add(s.bitrixTaskId);
  }

  // Allocate a fresh per-project number, retrying if a concurrent insert took it.
  // If the card already exists (a racing kaiten sync inserted it), adopt+update it.
  async function createOrAdopt(
    externalId: string,
    data: {
      title: string;
      description: string;
      status: 'TODO' | 'IN_PROGRESS' | 'DONE';
      dueDate: Date | null;
      assigneeId?: string | null;
    },
  ): Promise<{ id: string; created: boolean }> {
    // Seed the internal (board) status from the mapped Kaiten status so an
    // imported card lands in the matching column, not always Бэклог. After
    // import the user moves it on the board manually.
    const internalFk = await internalStatusFk(prisma, params.projectId, data.status);
    for (let attempt = 0; attempt < 6; attempt++) {
      const agg = await prisma.task.aggregate({ where: { projectId: params.projectId }, _max: { number: true } });
      try {
        const t = await prisma.task.create({
          data: {
            projectId: params.projectId,
            number: (agg._max.number ?? 0) + 1,
            title: data.title,
            description: data.description,
            status: data.status,
            internalStatus: data.status,
            ...mirrorStatusFk(params.projectId, data.status),
            ...internalFk,
            // A card imported already in DONE needs a completedAt, else it reads
            // as "done" but is invisible to every completion metric (throughput /
            // cycle-time / burndown all key off completedAt). Kaiten gives no
            // done-timestamp here, so stamp import time.
            ...(data.status === 'DONE' ? { completedAt: new Date() } : {}),
            dueDate: data.dueDate,
            assigneeId: data.assigneeId ?? null,
            creatorId: botId,
            externalSource: KAITEN_SOURCE,
            externalId,
          },
          select: { id: true },
        });
        return { id: t.id, created: true };
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        // Either the card was inserted concurrently, or the number collided.
        const existing = await prisma.task.findFirst({
          where: { projectId: params.projectId, externalSource: KAITEN_SOURCE, externalId },
          select: { id: true },
        });
        if (existing) {
          await prisma.task.update({
            where: { id: existing.id },
            data: { ...data, ...mirrorStatusFk(params.projectId, data.status) },
          });
          return { id: existing.id, created: false };
        }
        // Number collision → recompute max and retry.
      }
    }
    throw new Error('failed to allocate task number after retries');
  }

  // Mirror a card's Kaiten comments into the task. Author identities don't map to
  // local users, so the Kaiten author's name is prefixed into the body and the
  // comment is attributed to the bot. externalId is task-scoped so the same card
  // imported into two projects keeps independent comment copies.
  async function syncCardComments(taskId: string, cardId: number): Promise<number> {
    let list;
    try {
      list = await client.listCardComments(cardId);
    } catch (e) {
      errors.push(`comments ${cardId}: ${e instanceof Error ? e.message : String(e)}`);
      return 0;
    }
    if (list.length > MAX_COMMENTS_PER_CARD) {
      errors.push(`card ${cardId}: ${list.length} comments > cap ${MAX_COMMENTS_PER_CARD}, truncated`);
      list = list.slice(0, MAX_COMMENTS_PER_CARD);
    }
    // Comment ids we keep this run — used to reconcile deletions below.
    const keptIds = new Set<string>();
    let n = 0;
    for (const cm of list) {
      if (cm.deleted) continue;
      const text = (cm.text ?? '').trim();
      if (!text) continue;
      keptIds.add(String(cm.id));
      // Attribute to the real local user when we know the Kaiten author; only
      // fall back to the bot (with a name prefix) when we can't map them.
      const authorLocalId = cm.author_id != null ? userMap.get(cm.author_id) : undefined;
      if (authorLocalId) memberLocalIds.add(authorLocalId);
      // Neutralize markdown control chars in the prefixed name (cosmetic).
      const authorName = cm.author?.full_name?.trim().replace(/[*`_~[\]]/g, ' ').trim();
      const body = (authorLocalId || !authorName ? text : `**${authorName}:**\n\n${text}`).slice(0, 50_000);
      let createdAt = cm.created ? new Date(cm.created) : new Date();
      if (!Number.isFinite(createdAt.getTime())) createdAt = new Date();
      const externalId = `${taskId}:${cm.id}`;
      try {
        await prisma.comment.upsert({
          where: { externalSource_externalId: { externalSource: KAITEN_SOURCE, externalId } },
          update: { body, taskId, authorId: authorLocalId ?? botId },
          create: {
            taskId,
            authorId: authorLocalId ?? botId,
            body,
            source: 'WEB',
            visibility: 'EXTERNAL',
            externalSource: KAITEN_SOURCE,
            externalId,
            createdAt,
          },
        });
        n++;
      } catch (e) {
        errors.push(`comment ${cm.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    // Reconcile deletions: drop local Kaiten comments for this task whose source
    // comment is gone (deleted/removed upstream) — parity with the Bitrix mirror.
    try {
      const local = await prisma.comment.findMany({
        where: { taskId, externalSource: KAITEN_SOURCE },
        select: { id: true, externalId: true },
      });
      const stale = local
        .filter((c) => {
          const cid = c.externalId?.split(':')[1];
          return cid && !keptIds.has(cid);
        })
        .map((c) => c.id);
      if (stale.length) await prisma.comment.deleteMany({ where: { id: { in: stale } } });
    } catch (e) {
      errors.push(`comments-reconcile ${cardId}: ${e instanceof Error ? e.message : String(e)}`);
    }
    return n;
  }

  outer: for await (const page of client.listCardsPaged({ boardId: params.boardId })) {
    if (opts.signal?.aborted) break;
    for (const card of page) {
      if (cards >= MAX_CARDS) {
        truncated = true;
        break outer;
      }
      try {
        const externalId = String(card.id);
        seenLiveIds.add(externalId);
        const title = (card.title ?? '').trim() || 'Без названия';
        const status = stateToStatus(card.state, card.id);
        const dueDate = card.due_date ? new Date(card.due_date) : null;
        const description = card.description ?? '';
        // Card owner → local assignee (when the user is mapped). Also a member.
        const ownerLocalId = card.owner_id != null ? userMap.get(card.owner_id) : undefined;
        if (ownerLocalId) memberLocalIds.add(ownerLocalId);

        const prior = await prisma.task.findFirst({
          where: { projectId: params.projectId, externalSource: KAITEN_SOURCE, externalId },
          select: { id: true },
        });

        let taskId: string;
        if (prior) {
          await prisma.task.update({
            where: { id: prior.id },
            // Only set the assignee when the owner maps to a local user — never
            // clear a manually-set assignee just because the owner is unmapped.
            data: { title, description, status, ...mirrorStatusFk(params.projectId, status), dueDate, ...(ownerLocalId ? { assigneeId: ownerLocalId } : {}) },
          });
          taskId = prior.id;
          updated++;
        } else {
          const res = await createOrAdopt(externalId, { title, description, status, dueDate, assigneeId: ownerLocalId ?? null });
          taskId = res.id;
          if (res.created) created++;
          else updated++;
        }
        cards++;

        if (params.syncComments && (card.comments_total ?? 0) > 0) {
          commentsSynced += await syncCardComments(taskId, card.id);
        }

        // Skip matching if this Kaiten task already has a DUPLICATES link.
        const alreadyLinked = await prisma.taskDependency.findFirst({
          where: { fromTaskId: taskId, linkType: 'DUPLICATES' },
          select: { toTaskId: true },
        });
        if (alreadyLinked) {
          claimedBitrixIds.add(alreadyLinked.toTaskId);
          continue;
        }

        const open = candidates.filter((c) => !claimedBitrixIds.has(c.id));
        const match = bestMatchPrepared(card.title ?? title, open);
        if (!match) continue;
        if (match.confidence === 'auto') {
          try {
            await prisma.taskDependency.create({
              data: { fromTaskId: taskId, toTaskId: match.id, linkType: 'DUPLICATES', createdById: botId },
            });
            claimedBitrixIds.add(match.id);
            autoLinked++;
          } catch {
            // unique conflict — link already exists; treat as claimed
            claimedBitrixIds.add(match.id);
          }
        } else {
          // Medium confidence → persist for manual review, unless this exact pair
          // was already decided (accepted/rejected) so re-syncs don't re-propose it.
          const prior = await prisma.kaitenMatchSuggestion.findUnique({
            where: { kaitenTaskId_bitrixTaskId: { kaitenTaskId: taskId, bitrixTaskId: match.id } },
            select: { status: true },
          });
          if (!prior) {
            try {
              await prisma.kaitenMatchSuggestion.create({
                data: { projectId: params.projectId, kaitenTaskId: taskId, bitrixTaskId: match.id, score: match.score },
              });
              suggestions++;
            } catch (e) {
              if (!isUniqueViolation(e)) throw e; // concurrent create of same pair → tolerate; other errors surface
            }
            // One twin ↔ one card: don't propose the same Bitrix task to another card this run.
            claimedBitrixIds.add(match.id);
          } else if (prior.status === 'pending') {
            // Already proposed (and pre-claimed via the seed above) — keep it claimed, don't recount.
            claimedBitrixIds.add(match.id);
          }
        }
      } catch (e) {
        errors.push(`card ${card.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // Ensure the Kaiten people involved (card owners + comment authors) are project
  // members, so they're assignable and visible. Only ACTIVE users; createMany +
  // skipDuplicates is race-safe and never downgrades an existing member's role.
  let members = 0;
  if (memberLocalIds.size > 0) {
    try {
      const active = await prisma.user.findMany({
        where: { id: { in: [...memberLocalIds] }, isActive: true },
        select: { id: true },
      });
      if (active.length > 0) {
        const r = await prisma.projectMember.createMany({
          data: active.map((u) => ({ projectId: params.projectId, userId: u.id, role: 'CONTRIBUTOR' as const })),
          skipDuplicates: true,
        });
        members = r.count;
      }
    } catch (e) {
      errors.push(`members: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Reconcile pass: archived cards leave the live board, so reflect their final
  // state onto the existing local task (done→DONE, otherwise→CANCELED). Only
  // updates tasks we already imported — never creates from archived cards.
  if (params.reconcileArchived && !opts.signal?.aborted && !truncated) {
    let seen = 0;
    archived: for await (const page of client.listCardsPaged({ boardId: params.boardId, condition: 2 })) {
      if (opts.signal?.aborted) break;
      for (const card of page) {
        if (seen >= MAX_CARDS) {
          truncated = true;
          break archived;
        }
        seen++;
        try {
          const externalId = String(card.id);
          // A card seen live this run was just imported with its real state —
          // don't override it from a stale archived snapshot.
          if (seenLiveIds.has(externalId)) continue;
          const local = await prisma.task.findFirst({
            where: { projectId: params.projectId, externalSource: KAITEN_SOURCE, externalId },
            select: { id: true, status: true },
          });
          if (!local) continue;
          const target = card.state === 3 ? 'DONE' : 'CANCELED';
          if (local.status !== target) {
            await prisma.task.update({
              where: { id: local.id },
              data: { status: target, ...mirrorStatusFk(params.projectId, target) },
            });
            reconciled++;
          }
        } catch (e) {
          errors.push(`archived ${card.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  return {
    ok: errors.length === 0 && !truncated,
    cards,
    created,
    updated,
    autoLinked,
    suggestions,
    reconciled,
    comments: commentsSynced,
    members,
    usersCreated,
    truncated,
    errors: errors.slice(0, 50),
    durationMs: Date.now() - startedAt.getTime(),
  };
}
