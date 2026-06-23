import type { PrismaClient } from '@giper/db';
import { KaitenClient } from './client';
import { getKaitenBotUserId } from './botUser';
import { prepareCandidates, bestMatchPrepared } from './match';

export const KAITEN_SOURCE = 'kaiten';

/** Safety valve: refuse to import an implausibly huge board in one run, and say so. */
const MAX_CARDS = 20_000;

export type RunKaitenSyncResult = {
  ok: boolean;
  cards: number;
  created: number;
  updated: number;
  autoLinked: number;
  suggestions: number;
  truncated: boolean;
  errors: string[];
  durationMs: number;
};

/** Which Bitrix-mirrored tasks a card is matched against for the DUPLICATES link.
 *  'project' = only the connected project's tasks; 'org' = every project's (the
 *  remote team's board often spans several Bitrix projects). */
export type KaitenMatchScope = 'project' | 'org';

export type RunKaitenSyncParams = { projectId: string; boardId: number; matchScope?: KaitenMatchScope };
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
  let truncated = false;

  const botId = await getKaitenBotUserId(prisma);

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
    const existing = await prisma.taskDependency.findMany({
      where: { linkType: 'DUPLICATES', toTaskId: { in: bitrixTasks.map((b) => b.id) } },
      select: { toTaskId: true },
    });
    for (const e of existing) claimedBitrixIds.add(e.toTaskId);
  }

  // Allocate a fresh per-project number, retrying if a concurrent insert took it.
  // If the card already exists (a racing kaiten sync inserted it), adopt+update it.
  async function createOrAdopt(
    externalId: string,
    data: { title: string; description: string; status: 'TODO' | 'IN_PROGRESS' | 'DONE'; dueDate: Date | null },
  ): Promise<{ id: string; created: boolean }> {
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
            dueDate: data.dueDate,
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
          await prisma.task.update({ where: { id: existing.id }, data });
          return { id: existing.id, created: false };
        }
        // Number collision → recompute max and retry.
      }
    }
    throw new Error('failed to allocate task number after retries');
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
        const title = (card.title ?? '').trim() || 'Без названия';
        const status = stateToStatus(card.state, card.id);
        const dueDate = card.due_date ? new Date(card.due_date) : null;
        const description = card.description ?? '';

        const prior = await prisma.task.findFirst({
          where: { projectId: params.projectId, externalSource: KAITEN_SOURCE, externalId },
          select: { id: true },
        });

        let taskId: string;
        if (prior) {
          await prisma.task.update({ where: { id: prior.id }, data: { title, description, status, dueDate } });
          taskId = prior.id;
          updated++;
        } else {
          const res = await createOrAdopt(externalId, { title, description, status, dueDate });
          taskId = res.id;
          if (res.created) created++;
          else updated++;
        }
        cards++;

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
          suggestions++;
        }
      } catch (e) {
        errors.push(`card ${card.id}: ${e instanceof Error ? e.message : String(e)}`);
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
    truncated,
    errors: errors.slice(0, 50),
    durationMs: Date.now() - startedAt.getTime(),
  };
}
