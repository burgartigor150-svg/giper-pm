'use server';

import { revalidatePath } from 'next/cache';
import { Redis } from 'ioredis';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { canManageAssignments } from '@/lib/permissions';
import { createTask } from '@/lib/tasks/createTask';
import { expandRussianName } from '@giper/integrations';
import type { ApplyOverrides } from '@/actions/aiHarvest';

let _redis: Redis | null = null;
function redis(): Redis {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');
  _redis = new Redis(url);
  return _redis;
}

const PROPOSAL_KEY = (meetingId: string) => `ai:meeting:${meetingId}`;

type StoredProposal = {
  proposalId: string;
  title: string;
  description: string;
  type: 'TASK' | 'BUG' | 'FEATURE' | 'CHORE';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  suggestedAssigneeId: string | null;
  /** Raw name from the transcript ("Катя", "Сергей"). UI uses this
   *  to fetch the candidates picker. */
  mentionedAssigneeName: string | null;
  suggestedDueDate: string | null;
  sourceMessageIds: string[];
  rationale: string;
};

type StoredBundle = {
  proposals: StoredProposal[];
  projectKey: string;
  generatedAt: number;
  messageIndex?: Record<string, unknown>;
};

async function loadMeetingForUser(meetingId: string, userId: string, role: string) {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: {
      id: true,
      title: true,
      createdById: true,
      project: {
        select: {
          id: true,
          key: true,
          name: true,
          ownerId: true,
          members: {
            select: {
              userId: true,
              role: true,
              user: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });
  if (!meeting) return null;
  const allowed =
    role === 'ADMIN' ||
    meeting.createdById === userId ||
    (meeting.project &&
      canManageAssignments({ id: userId, role: role as 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER' }, meeting.project));
  if (!allowed) return null;
  return meeting;
}

export async function getMeetingProposalsAction({
  meetingId,
}: {
  meetingId: string;
}): Promise<
  | {
      ok: true;
      proposals: StoredProposal[];
      members: { id: string; name: string }[];
      generatedAt: number;
      projectKey: string | null;
    }
  | { ok: false; message: string }
> {
  const me = await requireAuth();
  const meeting = await loadMeetingForUser(meetingId, me.id, me.role);
  if (!meeting) return { ok: false, message: 'Встреча не найдена или нет прав' };
  if (!meeting.project) {
    return { ok: false, message: 'Встреча не привязана к проекту — задачи не предлагаем.' };
  }
  const raw = await redis().get(PROPOSAL_KEY(meetingId));
  if (!raw) {
    return {
      ok: true,
      proposals: [],
      members: meeting.project.members.map((m) => ({ id: m.user.id, name: m.user.name })),
      generatedAt: 0,
      projectKey: meeting.project.key,
    };
  }
  const bundle = JSON.parse(raw) as StoredBundle;
  return {
    ok: true,
    proposals: bundle.proposals,
    members: meeting.project.members.map((m) => ({ id: m.user.id, name: m.user.name })),
    generatedAt: bundle.generatedAt,
    projectKey: meeting.project.key,
  };
}

export async function discardMeetingProposalAction({
  meetingId,
  proposalId,
}: {
  meetingId: string;
  proposalId: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const me = await requireAuth();
  const meeting = await loadMeetingForUser(meetingId, me.id, me.role);
  if (!meeting) return { ok: false, message: 'Нет прав' };
  const raw = await redis().get(PROPOSAL_KEY(meetingId));
  if (!raw) return { ok: true };
  const bundle = JSON.parse(raw) as StoredBundle;
  bundle.proposals = bundle.proposals.filter((p) => p.proposalId !== proposalId);
  await redis().set(PROPOSAL_KEY(meetingId), JSON.stringify(bundle), 'EX', 24 * 60 * 60);
  return { ok: true };
}

export async function applyMeetingProposalAction({
  meetingId,
  proposalId,
  overrides,
}: {
  meetingId: string;
  proposalId: string;
  overrides?: ApplyOverrides;
}): Promise<
  | { ok: true; taskNumber: number; projectKey: string }
  | { ok: false; message: string }
> {
  const me = await requireAuth();
  const meeting = await loadMeetingForUser(meetingId, me.id, me.role);
  if (!meeting) return { ok: false, message: 'Нет прав' };
  if (!meeting.project) return { ok: false, message: 'Встреча без проекта' };
  const raw = await redis().get(PROPOSAL_KEY(meetingId));
  if (!raw) return { ok: false, message: 'Кэш предложений истёк' };
  const bundle = JSON.parse(raw) as StoredBundle;
  const proposal = bundle.proposals.find((p) => p.proposalId === proposalId);
  if (!proposal) return { ok: false, message: 'Предложение не найдено' };

  const title = overrides?.title?.trim() || proposal.title;
  const description = overrides?.description ?? proposal.description;
  const type = overrides?.type ?? (proposal.type as ApplyOverrides['type']);
  const priority = overrides?.priority ?? proposal.priority;
  const assigneeId =
    overrides?.assigneeId !== undefined ? overrides.assigneeId : proposal.suggestedAssigneeId;
  const dueDateInput =
    overrides?.dueDate !== undefined ? overrides.dueDate : proposal.suggestedDueDate;
  const dueDate = dueDateInput ? new Date(dueDateInput) : undefined;

  // If the picked assignee isn't a project member yet (typical for the
  // disambiguation-picker flow — PM resolved "Катя" to a Екатерина from
  // another team), auto-add them as CONTRIBUTOR. Otherwise createTask
  // would reject with VALIDATION. We only do this when the caller has
  // permission to manage the project (already checked above via
  // canManageAssignments inside loadMeetingForUser's `allowed` gate).
  if (assigneeId) {
    const isMember =
      assigneeId === meeting.project.ownerId ||
      meeting.project.members.some((m) => m.user.id === assigneeId);
    if (!isMember) {
      const userExists = await prisma.user.findUnique({
        where: { id: assigneeId },
        select: { id: true, isActive: true },
      });
      if (!userExists || !userExists.isActive) {
        return {
          ok: false,
          message: 'Выбранный исполнитель не существует или деактивирован',
        };
      }
      await prisma.projectMember.create({
        data: {
          projectId: meeting.project.id,
          userId: assigneeId,
          role: 'CONTRIBUTOR',
        },
      });
    }
  }

  const created = await createTask(
    {
      projectKey: meeting.project.key,
      title,
      description: description || undefined,
      priority,
      type,
      assigneeId: assigneeId || undefined,
      estimateHours: overrides?.estimateHours ?? undefined,
      dueDate: dueDate && !isNaN(dueDate.getTime()) ? dueDate : undefined,
      tags: [],
    },
    { id: me.id, role: me.role },
  );

  bundle.proposals = bundle.proposals.filter((p) => p.proposalId !== proposalId);
  await redis().set(PROPOSAL_KEY(meetingId), JSON.stringify(bundle), 'EX', 24 * 60 * 60);

  revalidatePath(`/projects/${meeting.project.key}`);
  revalidatePath(`/projects/${meeting.project.key}/list`);
  revalidatePath(`/meetings/${meetingId}`);

  return { ok: true, taskNumber: created.number, projectKey: created.project.key };
}

/**
 * Resolve a mentioned name (e.g. "Катя") from a meeting transcript
 * into a ranked list of candidate users. Used by the proposal card
 * picker UI when the AI deliberately didn't guess an assignee.
 *
 * Ranking: project members first (most likely the intended person),
 * then any active org-wide user whose name starts with the mentioned
 * name or one of its Russian-diminutive expansions. Capped at 20.
 *
 * We DON'T fall back to surnames or partial matches — that's how
 * misroutes happen. If the speech was "Катя" we look at names
 * starting with "Катя" or "Екатерина", nothing else.
 */
export async function searchCandidateAssigneesAction({
  meetingId,
  mentionedName,
}: {
  meetingId: string;
  mentionedName: string;
}): Promise<
  | { ok: true; candidates: { id: string; name: string; email: string; inProject: boolean }[] }
  | { ok: false; message: string }
> {
  const me = await requireAuth();
  const meeting = await loadMeetingForUser(meetingId, me.id, me.role);
  if (!meeting) return { ok: false, message: 'Нет прав' };

  const trimmed = mentionedName.trim();
  if (trimmed.length < 2) return { ok: true, candidates: [] };

  const variants = expandRussianName(trimmed);
  // Build the OR list once — every variant becomes a name-prefix match.
  // Case-insensitive: Prisma startsWith mode 'insensitive' uses
  // citext-compatible ILIKE under the hood.
  const orClauses = variants.map((v) => ({
    name: { startsWith: v, mode: 'insensitive' as const },
  }));

  const inProjectIds = new Set(
    (meeting.project?.members ?? []).map((m) => m.user.id),
  );

  const all = await prisma.user.findMany({
    where: {
      isActive: true,
      OR: orClauses,
    },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
    take: 40,
  });
  // Rank: project members first, then the rest. Cap at 20 — if the
  // PM has more than 20 Катя's they need a real search box, not a
  // picker.
  const enriched = all.map((u) => ({
    ...u,
    inProject: inProjectIds.has(u.id),
  }));
  enriched.sort((a, b) => {
    if (a.inProject !== b.inProject) return a.inProject ? -1 : 1;
    return a.name.localeCompare(b.name, 'ru');
  });
  return { ok: true, candidates: enriched.slice(0, 20) };
}
