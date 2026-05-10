'use server';

import { revalidatePath } from 'next/cache';
import { Redis } from 'ioredis';
import { prisma } from '@giper/db';
import { proposeTasks, type TaskProposal } from '@giper/integrations';
import { requireAuth } from '@/lib/auth';
import { canManageAssignments } from '@/lib/permissions';
import { createTask } from '@/lib/tasks/createTask';

let _redis: Redis | null = null;
function redis(): Redis {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');
  _redis = new Redis(url);
  return _redis;
}

const PROPOSAL_TTL_SECONDS = 30 * 60;
const RATE_LIMIT_KEY = (userId: string) => `ai:harvest:cooldown:${userId}`;
const RATE_LIMIT_SECONDS = 30;
const MAX_REQUEST_MESSAGES = 200;

const PROPOSAL_KEY = (linkId: string, userId: string) => `ai:harvest:proposals:${linkId}:${userId}`;

type StoredProposal = TaskProposal & { proposalId: string };
type StoredBundle = {
  proposals: StoredProposal[];
  // Materialised message metadata for download (so the bot can find the
  // attachments without re-querying the DB at apply time).
  messageIndex: Record<
    string,
    {
      messageId: string;
      attachments: {
        telegramFileId: string;
        fileName: string;
        mimeType: string | null;
        sizeBytes: number | null;
      }[];
    }
  >;
  botId: string;
  projectId: string;
  projectKey: string;
  generatedAt: number;
};

async function loadLinkForUser(linkId: string, userId: string, role: string) {
  const link = await prisma.projectTelegramChat.findUnique({
    where: { id: linkId },
    include: {
      bot: { select: { id: true, userId: true, botUsername: true } },
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
  if (!link) return null;
  const allowed =
    link.bot.userId === userId ||
    canManageAssignments({ id: userId, role: role as 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER' }, link.project);
  if (!allowed) return null;
  return link;
}

function pickProposalId(): string {
  return `p_${Math.random().toString(36).slice(2, 10)}`;
}

export async function proposeAiHarvestAction({
  linkId,
}: {
  linkId: string;
}): Promise<
  | {
      ok: true;
      proposals: StoredProposal[];
      usedMessages: number;
      truncated: boolean;
      members: { id: string; name: string }[];
      generatedAt: number;
    }
  | { ok: false; message: string }
> {
  const me = await requireAuth();
  const cooldown = await redis().get(RATE_LIMIT_KEY(me.id));
  if (cooldown) {
    return {
      ok: false,
      message: `Подождите ещё ~${cooldown} с — анализ можно запускать раз в ${RATE_LIMIT_SECONDS} с.`,
    };
  }

  const link = await loadLinkForUser(linkId, me.id, me.role);
  if (!link) return { ok: false, message: 'Привязка не найдена или нет прав' };

  const rows = await prisma.telegramProjectMessage.findMany({
    where: { linkId, harvestedAt: null },
    orderBy: { capturedAt: 'desc' },
    take: MAX_REQUEST_MESSAGES,
    select: {
      id: true,
      fromUsername: true,
      fromTgUserId: true,
      capturedAt: true,
      text: true,
      attachments: true,
    },
  });

  if (!rows.length) {
    return {
      ok: true,
      proposals: [],
      usedMessages: 0,
      truncated: false,
      members: link.project.members.map((m) => ({ id: m.user.id, name: m.user.name })),
      generatedAt: Date.now(),
    };
  }

  const chronological = [...rows].reverse();
  const messageIndex: StoredBundle['messageIndex'] = {};
  // Track voice/video_note attachments that haven't been transcribed
  // yet — we kick off a batch and ask the user to retry in a few sec.
  const needsTranscribe: string[] = [];
  const llmInput = chronological.map((r) => {
    const atts = (Array.isArray(r.attachments) ? r.attachments : []) as {
      telegramFileId: string;
      fileName: string;
      mimeType: string | null;
      sizeBytes: number | null;
      transcript?: string;
    }[];
    messageIndex[r.id] = { messageId: r.id, attachments: atts };
    const voiceWithoutTranscript = atts.some((a) => {
      if (a.transcript) return false;
      const isVoice =
        a.mimeType?.includes('audio') ||
        a.mimeType?.includes('video') ||
        a.fileName.startsWith('voice-') ||
        a.fileName.startsWith('audio-') ||
        a.fileName.endsWith('.ogg') ||
        a.fileName.endsWith('.oga');
      return isVoice;
    });
    if (voiceWithoutTranscript) needsTranscribe.push(r.id);
    return {
      id: r.id,
      author: r.fromUsername || r.fromTgUserId || 'unknown',
      timestamp: r.capturedAt.toISOString(),
      text: r.text,
      hasAttachment: atts.length > 0,
    };
  });

  if (needsTranscribe.length > 0) {
    try {
      await redis().publish(
        'tg:transcribe-voice',
        JSON.stringify({ messageIds: needsTranscribe }),
      );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[aiHarvest] publish tg:transcribe-voice failed', e);
    }
    return {
      ok: false,
      message: `Сначала распознаём ${needsTranscribe.length} голосовых сообщений (~${Math.max(15, needsTranscribe.length * 8)} сек). Нажмите «Анализ ИИ» ещё раз через минуту.`,
    };
  }

  const members = link.project.members.map((m) => ({ id: m.user.id, name: m.user.name }));
  const result = await proposeTasks(llmInput, {
    key: link.project.key,
    name: link.project.name,
    members,
  });

  if (!result.ok) {
    return { ok: false, message: `ИИ не смог разобрать чат: ${result.message}` };
  }

  const stored: StoredProposal[] = result.proposals.map((p) => ({
    ...p,
    proposalId: pickProposalId(),
  }));

  const bundle: StoredBundle = {
    proposals: stored,
    messageIndex,
    botId: link.bot.id,
    projectId: link.project.id,
    projectKey: link.project.key,
    generatedAt: Date.now(),
  };
  await redis().set(PROPOSAL_KEY(linkId, me.id), JSON.stringify(bundle), 'EX', PROPOSAL_TTL_SECONDS);
  await redis().set(RATE_LIMIT_KEY(me.id), '1', 'EX', RATE_LIMIT_SECONDS);

  return {
    ok: true,
    proposals: stored,
    usedMessages: result.usedMessages,
    truncated: result.truncated,
    members,
    generatedAt: bundle.generatedAt,
  };
}

export async function discardAiHarvestProposalAction({
  linkId,
  proposalId,
}: {
  linkId: string;
  proposalId: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const me = await requireAuth();
  const raw = await redis().get(PROPOSAL_KEY(linkId, me.id));
  if (!raw) return { ok: false, message: 'Кэш предложений истёк, проанализируйте заново' };
  const bundle = JSON.parse(raw) as StoredBundle;
  bundle.proposals = bundle.proposals.filter((p) => p.proposalId !== proposalId);
  await redis().set(PROPOSAL_KEY(linkId, me.id), JSON.stringify(bundle), 'EX', PROPOSAL_TTL_SECONDS);
  return { ok: true };
}

export async function clearAiHarvestProposalsAction({
  linkId,
}: {
  linkId: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const me = await requireAuth();
  await redis().del(PROPOSAL_KEY(linkId, me.id));
  return { ok: true };
}

export type ApplyOverrides = {
  title?: string;
  description?: string;
  type?: 'TASK' | 'BUG' | 'FEATURE' | 'EPIC' | 'CHORE';
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  assigneeId?: string | null;
  dueDate?: string | null;
  estimateHours?: number | null;
};

export async function applyAiHarvestProposalAction({
  linkId,
  proposalId,
  overrides,
}: {
  linkId: string;
  proposalId: string;
  overrides?: ApplyOverrides;
}): Promise<
  | { ok: true; taskNumber: number; projectKey: string; willDownloadFiles: number }
  | { ok: false; message: string }
> {
  const me = await requireAuth();
  const raw = await redis().get(PROPOSAL_KEY(linkId, me.id));
  if (!raw) return { ok: false, message: 'Кэш предложений истёк, проанализируйте заново' };
  const bundle = JSON.parse(raw) as StoredBundle;
  const proposal = bundle.proposals.find((p) => p.proposalId === proposalId);
  if (!proposal) return { ok: false, message: 'Предложение не найдено (уже обработано?)' };

  // Re-verify access — bundle is per-user-per-link but cheap.
  const link = await loadLinkForUser(linkId, me.id, me.role);
  if (!link) return { ok: false, message: 'Нет прав на этот чат' };

  const title = overrides?.title?.trim() || proposal.title;
  const description = overrides?.description ?? proposal.description;
  const type = overrides?.type ?? (proposal.type as ApplyOverrides['type']);
  const priority = overrides?.priority ?? proposal.priority;
  const assigneeId =
    overrides?.assigneeId !== undefined ? overrides.assigneeId : proposal.suggestedAssigneeId;
  const dueDateInput =
    overrides?.dueDate !== undefined ? overrides.dueDate : proposal.suggestedDueDate;
  const dueDate = dueDateInput ? new Date(dueDateInput) : undefined;

  const created = await createTask(
    {
      projectKey: bundle.projectKey,
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

  // Mark source messages as harvested.
  await prisma.telegramProjectMessage.updateMany({
    where: { id: { in: proposal.sourceMessageIds }, harvestedAt: null },
    data: { harvestedAt: new Date() },
  });

  // Schedule file downloads via the tg-bot runner. Only request files for
  // the messages this proposal actually covers.
  const filesToDownload: {
    telegramFileId: string;
    fileName: string;
    mimeType: string | null;
    sizeBytes: number | null;
    sourceMessageId: string;
  }[] = [];
  for (const mid of proposal.sourceMessageIds) {
    const idx = bundle.messageIndex[mid];
    if (!idx) continue;
    for (const a of idx.attachments) {
      filesToDownload.push({ ...a, sourceMessageId: mid });
    }
  }

  if (filesToDownload.length) {
    const payload = {
      botId: bundle.botId,
      taskId: created.id,
      uploadedById: me.id,
      files: filesToDownload,
    };
    try {
      await redis().publish('tg:download-files', JSON.stringify(payload));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[aiHarvest] publish download-files failed', e);
    }
  }

  // Drop the proposal from the cached bundle so it disappears from UI.
  bundle.proposals = bundle.proposals.filter((p) => p.proposalId !== proposalId);
  await redis().set(PROPOSAL_KEY(linkId, me.id), JSON.stringify(bundle), 'EX', PROPOSAL_TTL_SECONDS);

  revalidatePath(`/projects/${bundle.projectKey}`);
  revalidatePath(`/projects/${bundle.projectKey}/telegram`);
  revalidatePath(`/projects/${bundle.projectKey}/list`);

  return {
    ok: true,
    taskNumber: created.number,
    projectKey: created.project.key,
    willDownloadFiles: filesToDownload.length,
  };
}
