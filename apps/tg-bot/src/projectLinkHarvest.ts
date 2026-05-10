/**
 * Per-bot handlers: project ↔ Telegram chat linking, message ingest,
 * and `/harvest` → Task creation.
 *
 * Each bot in the multi-bot runner is "owned" by exactly one PM
 * (UserTelegramBot.userId). All actions are authorised against that
 * owner — we never look up `tgChatId` on User anymore (that pairing
 * was removed when we dropped the single org-wide bot model).
 */

import type { Bot, Context } from 'grammy';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '@giper/db';
import { runHarvest } from '@giper/integrations';

type SlimProject = {
  id: string;
  key: string;
  ownerId: string;
  members: { userId: string; role: string }[];
};

export type OwningBot = {
  id: string;
  userId: string;
  botUsername: string;
};

function harvestAllowed(
  user: { id: string; role: string },
  project: SlimProject,
): boolean {
  if (user.role === 'ADMIN' || user.role === 'PM') return true;
  if (project.ownerId === user.id) return true;
  return project.members.some((m) => m.userId === user.id && m.role === 'LEAD');
}

async function loadOwner(prisma: PrismaClient, userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true, isActive: true },
  });
}

async function loadProject(prisma: PrismaClient, projectId: string): Promise<SlimProject | null> {
  return prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      key: true,
      ownerId: true,
      members: { select: { userId: true, role: true } },
    },
  });
}

export function registerBotHandlers(
  bot: Bot,
  redis: Redis,
  prisma: PrismaClient,
  owningBot: OwningBot,
) {
  bot.command('start', async (ctx) => {
    const arg = (ctx.match || '').toString().trim();
    if (arg) {
      // start payloads with codes are no longer used; just greet.
    }
    await ctx.reply(
      [
        `Привет! Я бот giper-pm пользователя @${owningBot.botUsername}.`,
        '',
        'Меня нужно добавить в групповой чат вашего проекта и:',
        '/linkproj TG-XXXXXX — привязать этот чат к проекту (код возьмите в вебе на странице «Интеграции → Telegram»)',
        '/harvest [N] — собрать последние N сообщений в задачи (по умолчанию 25, максимум 100)',
        '/help — повторить эту шпаргалку',
        '',
        'Важно: в @BotFather у меня должен быть отключён Group Privacy — иначе я не вижу обычные сообщения в группе.',
      ].join('\n'),
    );
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      [
        'Команды:',
        '/linkproj TG-XXXXXX — в группе: привязать чат к проекту',
        '/harvest [N] — в привязанной группе: создать задачи из последних N сообщений',
      ].join('\n'),
    );
  });

  bot.command('linkproj', async (ctx) => {
    const chat = ctx.chat;
    if (!chat || chat.type === 'private') {
      await ctx.reply(
        'Команду /linkproj нужно отправить в групповом чате (или супергруппе), куда добавлен бот.',
      );
      return;
    }

    const rawArg = (ctx.match || '').toString().trim();
    const codeKey = rawArg.toUpperCase().replace(/^TG-/, '');
    if (!codeKey) {
      await ctx.reply('Использование: /linkproj TG-XXXXXX (код возьмите в вебе на странице проекта)');
      return;
    }

    const payload = await redis.get(`tg:plink:${codeKey}`);
    if (!payload) {
      await ctx.reply('Код не найден или истёк. Сгенерируйте новый в вебе.');
      return;
    }

    let parsed: { projectId: string; userId: string; botId: string };
    try {
      parsed = JSON.parse(payload) as { projectId: string; userId: string; botId: string };
    } catch {
      await ctx.reply('Битый код, сгенерируйте новый.');
      return;
    }

    if (parsed.botId !== owningBot.id) {
      await ctx.reply(
        'Этот код выпустил пользователь, у которого подключён другой бот. Сгенерируйте код в вебе под своей учёткой.',
      );
      return;
    }
    if (parsed.userId !== owningBot.userId) {
      await ctx.reply('Код принадлежит другому пользователю giper-pm.');
      return;
    }

    const owner = await loadOwner(prisma, owningBot.userId);
    if (!owner || !owner.isActive) {
      await ctx.reply('Учётка владельца бота не найдена или отключена в giper-pm.');
      return;
    }

    const project = await loadProject(prisma, parsed.projectId);
    if (!project) {
      await ctx.reply('Проект не найден.');
      return;
    }
    if (!harvestAllowed(owner, project)) {
      await ctx.reply('Недостаточно прав для привязки чата к этому проекту.');
      return;
    }

    const telegramChatId = String(chat.id);
    const chatTitle = 'title' in chat ? chat.title ?? null : null;

    await prisma.projectTelegramChat.upsert({
      where: {
        botId_telegramChatId: {
          botId: owningBot.id,
          telegramChatId,
        },
      },
      create: {
        projectId: project.id,
        botId: owningBot.id,
        telegramChatId,
        chatTitle,
        linkedByUserId: owner.id,
      },
      update: {
        projectId: project.id,
        chatTitle,
        linkedByUserId: owner.id,
      },
    });

    await redis.del(`tg:plink:${codeKey}`);
    await ctx.reply(
      [
        `Чат привязан к проекту ${project.key}.`,
        'Пишите задачи обычными сообщениями — бот их копит.',
        'Команда /harvest (или /harvest 40) создаст задачи из последних сообщений.',
        'Это же можно сделать кнопкой в вебе на странице «Интеграции → Telegram» или «Проект → Telegram».',
      ].join('\n'),
    );
  });

  bot.command('harvest', async (ctx) => {
    const chat = ctx.chat;
    if (!chat || chat.type === 'private') {
      await ctx.reply('/harvest нужно вызывать в привязанном групповом чате.');
      return;
    }

    const telegramChatId = String(chat.id);
    const link = await prisma.projectTelegramChat.findUnique({
      where: {
        botId_telegramChatId: {
          botId: owningBot.id,
          telegramChatId,
        },
      },
      include: {
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
    if (!link) {
      await ctx.reply('Этот чат не привязан к проекту. Сначала /linkproj TG-…');
      return;
    }

    const owner = await loadOwner(prisma, owningBot.userId);
    if (!owner || !owner.isActive) {
      await ctx.reply('Учётка владельца бота не найдена или отключена в giper-pm.');
      return;
    }
    if (!harvestAllowed(owner, link.project)) {
      await ctx.reply('Недостаточно прав создавать задачи в этом проекте.');
      return;
    }

    const arg = (ctx.match || '').toString().trim();
    const limit = parseInt(arg, 10) || 25;
    const result = await runHarvest(prisma, link, owner.id, limit);

    if (result.emptyBuffer) {
      await ctx.reply('В буфере нет неразобранных сообщений (или они уже собраны).');
      return;
    }
    if (!result.createdTaskNumbers.length) {
      await ctx.reply('Не удалось создать задачи из буфера (пустой текст?).');
      return;
    }

    const created = result.createdTaskNumbers;
    const preview = created.slice(0, 15).map((n) => `${link.project.key}-${n}`).join(', ');
    const more = created.length > 15 ? ` … +${created.length - 15}` : '';
    await ctx.reply(`Создано задач: ${created.length}. ${preview}${more}`);
  });

  async function ingestText(ctx: Context) {
    const chat = ctx.chat;
    if (!chat) return;

    const msg = ctx.message ?? ctx.channelPost;
    if (!msg || !('text' in msg) || !msg.text) return;

    const t = msg.text.trim();
    if (t.startsWith('/')) return;

    if (ctx.from?.is_bot) return;

    const entities = 'entities' in msg ? msg.entities : undefined;
    if (entities?.some((e) => e.type === 'bot_command')) return;

    const telegramChatId = String(chat.id);
    const link = await prisma.projectTelegramChat.findUnique({
      where: {
        botId_telegramChatId: {
          botId: owningBot.id,
          telegramChatId,
        },
      },
      select: { id: true },
    });
    if (!link) return;

    const messageId = msg.message_id;
    const from = ctx.from;
    const fromTgUserId = from ? String(from.id) : null;
    const fromUsername = from?.username ?? null;

    try {
      await prisma.telegramProjectMessage.create({
        data: {
          linkId: link.id,
          telegramChatId,
          messageId,
          fromTgUserId,
          fromUsername,
          text: msg.text,
        },
      });
    } catch (e: unknown) {
      const msgStr = e instanceof Error ? e.message : '';
      if (!msgStr.includes('Unique constraint') && !msgStr.includes('duplicate')) {
        // eslint-disable-next-line no-console
        console.error('[tg-bot] ingest failed', e);
      }
    }
  }

  bot.on('message:text', ingestText);
  bot.on('channel_post:text', ingestText);

  bot.catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[tg-bot:${owningBot.botUsername}] handler error`, err);
  });
}
