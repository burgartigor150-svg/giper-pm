'use server';

import { revalidatePath } from 'next/cache';
import { Redis } from 'ioredis';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { canManageAssignments } from '@/lib/permissions';

let _redis: Redis | null = null;
function redis(): Redis {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');
  _redis = new Redis(url);
  return _redis;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LINK_TTL_SECONDS = 10 * 60;

function newCode(len = 6): string {
  let s = '';
  for (let i = 0; i < len; i++) {
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]!;
  }
  return s;
}

async function loadProjectForPerm(projectKey: string) {
  return prisma.project.findUnique({
    where: { key: projectKey },
    select: {
      id: true,
      key: true,
      ownerId: true,
      members: { select: { userId: true, role: true } },
    },
  });
}

export async function generateProjectTelegramLinkCodeAction(projectKey: string): Promise<{
  code: string;
  expiresAt: number;
  botUsername: string;
}> {
  const me = await requireAuth();
  const project = await loadProjectForPerm(projectKey);
  if (!project) throw new Error('Проект не найден');
  if (!canManageAssignments({ id: me.id, role: me.role }, project)) {
    throw new Error('Недостаточно прав (нужны права PM / лида проекта)');
  }

  // The user must have their own personal Telegram bot connected — that
  // bot will be the one ingesting messages in the group. Without it the
  // /linkproj command would have nothing to react to.
  const bot = await prisma.userTelegramBot.findFirst({
    where: { userId: me.id, isActive: true },
    orderBy: { createdAt: 'desc' },
    select: { id: true, botUsername: true },
  });
  if (!bot) {
    throw new Error(
      'Сначала подключите своего Telegram-бота на странице «Интеграции → Telegram».',
    );
  }

  let suffix = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    const c = newCode();
    const ok = await redis().set(
      `tg:plink:${c}`,
      JSON.stringify({ projectId: project.id, userId: me.id, botId: bot.id }),
      'EX',
      LINK_TTL_SECONDS,
      'NX',
    );
    if (ok === 'OK') {
      suffix = c;
      break;
    }
  }
  if (!suffix) throw new Error('Не удалось сгенерировать код, попробуй ещё раз');
  return {
    code: `TG-${suffix}`,
    expiresAt: Date.now() + LINK_TTL_SECONDS * 1000,
    botUsername: bot.botUsername,
  };
}

export async function unlinkProjectTelegramChatAction(
  projectKey: string,
  linkId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const me = await requireAuth();
  const project = await loadProjectForPerm(projectKey);
  if (!project) return { ok: false, message: 'Проект не найден' };
  if (!canManageAssignments({ id: me.id, role: me.role }, project)) {
    return { ok: false, message: 'Недостаточно прав' };
  }
  const row = await prisma.projectTelegramChat.findFirst({
    where: { id: linkId, projectId: project.id },
    select: { id: true },
  });
  if (!row) return { ok: false, message: 'Привязка не найдена' };
  await prisma.projectTelegramChat.delete({ where: { id: linkId } });
  revalidatePath(`/projects/${projectKey}`);
  revalidatePath(`/projects/${projectKey}/telegram`);
  return { ok: true };
}
