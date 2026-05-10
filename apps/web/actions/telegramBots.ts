'use server';

import { revalidatePath } from 'next/cache';
import { Redis } from 'ioredis';
import { prisma } from '@giper/db';
import { runHarvest } from '@giper/integrations';
import { requireAuth } from '@/lib/auth';
import { canManageAssignments, canSeeSettings } from '@/lib/permissions';
import { encryptToken } from '@/lib/tgTokenCrypto';

/**
 * Per-user Telegram bot lifecycle. The user creates a bot in @BotFather,
 * pastes the token here, and we:
 *   1. Validate via getMe (fetch).
 *   2. Encrypt the token AES-256-GCM with TG_TOKEN_ENC_KEY.
 *   3. Upsert UserTelegramBot.
 *   4. Publish 'tg:bots:reload' on Redis so the multi-bot runner picks
 *      up the new bot without a redeploy.
 *
 * The runner ALSO reconciles every 60s as a safety net.
 */

let _redis: Redis | null = null;
function redis(): Redis {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');
  _redis = new Redis(url);
  return _redis;
}

export const TG_BOTS_RELOAD_CHANNEL = 'tg:bots:reload';

type ReloadEvent =
  | { action: 'add' | 'update'; botId: string }
  | { action: 'remove'; botId: string };

async function publishReload(ev: ReloadEvent): Promise<void> {
  try {
    await redis().publish(TG_BOTS_RELOAD_CHANNEL, JSON.stringify(ev));
  } catch (e) {
    // Reconciler timer covers any pub/sub miss; log and proceed.
    // eslint-disable-next-line no-console
    console.warn('[telegramBots] publish reload failed', e);
  }
}

const TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,}$/;

type TgGetMe = {
  ok: boolean;
  result?: { id: number; username?: string; first_name?: string; is_bot?: boolean };
  description?: string;
};

async function callGetMe(token: string): Promise<TgGetMe['result']> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: ctrl.signal,
    });
    const json = (await res.json()) as TgGetMe;
    if (!res.ok || !json.ok || !json.result) {
      throw new Error(json.description || `Telegram getMe HTTP ${res.status}`);
    }
    if (!json.result.is_bot) {
      throw new Error('Этот токен принадлежит обычному аккаунту, а не боту');
    }
    return json.result;
  } finally {
    clearTimeout(t);
  }
}

export async function connectTelegramBotAction({
  token,
}: {
  token: string;
}): Promise<{
  ok: true;
  bot: { id: string; botUsername: string; botName: string | null };
} | { ok: false; message: string }> {
  const me = await requireAuth();
  if (!canSeeSettings({ id: me.id, role: me.role })) {
    return { ok: false, message: 'Подключать ботов могут только PM или администратор' };
  }
  const trimmed = (token || '').trim();
  if (!TOKEN_RE.test(trimmed)) {
    return {
      ok: false,
      message: 'Похоже на неправильный токен. Формат: 1234567890:AA…',
    };
  }

  let info: NonNullable<TgGetMe['result']>;
  try {
    info = (await callGetMe(trimmed))!;
  } catch (e) {
    return {
      ok: false,
      message: `Telegram отверг токен: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // Token encryption requires TG_TOKEN_ENC_KEY; surface a clean error in UI
  // instead of throwing if env is missing on this deploy.
  let encrypted: string;
  try {
    encrypted = encryptToken(trimmed);
  } catch (e) {
    return {
      ok: false,
      message: `Шифрование недоступно: ${e instanceof Error ? e.message : String(e)}. Обратитесь к администратору.`,
    };
  }

  const botTgId = String(info.id);
  const botUsername = info.username || 'unknown';
  const botName = info.first_name ?? null;

  // If this bot is already linked to a different user, refuse — same
  // token cannot be polled by two installations at once.
  const existing = await prisma.userTelegramBot.findUnique({
    where: { botTgId },
    select: { id: true, userId: true },
  });
  if (existing && existing.userId !== me.id) {
    return {
      ok: false,
      message: 'Этот бот уже подключён к другому пользователю giper-pm.',
    };
  }

  const row = await prisma.userTelegramBot.upsert({
    where: { botTgId },
    create: {
      userId: me.id,
      botTgId,
      botUsername,
      botName,
      encryptedToken: encrypted,
      isActive: true,
    },
    update: {
      botUsername,
      botName,
      encryptedToken: encrypted,
      isActive: true,
      lastError: null,
    },
    select: { id: true, botUsername: true, botName: true },
  });

  await publishReload({ action: 'update', botId: row.id });
  revalidatePath('/integrations/telegram');
  return { ok: true, bot: row };
}

export async function disconnectTelegramBotAction({
  botId,
}: {
  botId: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const me = await requireAuth();
  const row = await prisma.userTelegramBot.findUnique({
    where: { id: botId },
    select: { id: true, userId: true },
  });
  if (!row) return { ok: false, message: 'Бот не найден' };
  if (row.userId !== me.id && me.role !== 'ADMIN') {
    return { ok: false, message: 'Можно отключать только своих ботов' };
  }
  // Hard delete: removes ProjectTelegramChat rows via CASCADE, drops
  // buffered TelegramProjectMessage rows too. Re-adding the same bot
  // (same token) starts clean.
  await prisma.userTelegramBot.delete({ where: { id: botId } });
  await publishReload({ action: 'remove', botId });
  revalidatePath('/integrations/telegram');
  return { ok: true };
}

export async function harvestProjectChatAction({
  linkId,
  limit,
}: {
  linkId: string;
  limit?: number;
}): Promise<
  | { ok: true; created: number[]; emptyBuffer: boolean; projectKey: string }
  | { ok: false; message: string }
> {
  const me = await requireAuth();
  const link = await prisma.projectTelegramChat.findUnique({
    where: { id: linkId },
    include: {
      bot: { select: { userId: true } },
      project: {
        select: {
          id: true,
          key: true,
          ownerId: true,
          members: { select: { userId: true, role: true } },
        },
      },
    },
  });
  if (!link) return { ok: false, message: 'Привязка не найдена' };
  if (
    link.bot.userId !== me.id &&
    !canManageAssignments({ id: me.id, role: me.role }, link.project)
  ) {
    return { ok: false, message: 'Недостаточно прав для сбора задач из этого чата' };
  }

  const result = await runHarvest(prisma, link, me.id, limit ?? 25);
  revalidatePath(`/projects/${link.project.key}/telegram`);
  revalidatePath(`/projects/${link.project.key}`);
  return {
    ok: true,
    created: result.createdTaskNumbers,
    emptyBuffer: result.emptyBuffer,
    projectKey: link.project.key,
  };
}
