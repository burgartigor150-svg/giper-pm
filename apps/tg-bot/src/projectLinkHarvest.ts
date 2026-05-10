/**
 * Project ↔ Telegram chat linking + message buffer + /harvest → Task rows.
 */

import type { Bot, Context } from 'grammy';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '@giper/db';

type SlimProject = {
  id: string;
  key: string;
  ownerId: string;
  members: { userId: string; role: string }[];
};

export async function findPairedUser(
  prisma: PrismaClient,
  ctx: Context,
): Promise<{ id: string; name: string; role: string } | null> {
  if (!ctx.chat || !ctx.from) return null;
  // Private chat: chat.id === user's Telegram id. Groups: use sender id.
  const actorId = ctx.chat.type === 'private' ? ctx.chat.id : ctx.from.id;
  return prisma.user.findUnique({
    where: { tgChatId: String(actorId) },
    select: { id: true, name: true, role: true },
  });
}

function harvestAllowed(
  user: { id: string; role: string },
  project: SlimProject,
): boolean {
  if (user.role === 'ADMIN' || user.role === 'PM') return true;
  if (project.ownerId === user.id) return true;
  return project.members.some((m) => m.userId === user.id && m.role === 'LEAD');
}

async function loadProject(prisma: PrismaClient, projectId: string): Promise<SlimProject | null> {
  const p = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      key: true,
      ownerId: true,
      members: { select: { userId: true, role: true } },
    },
  });
  return p;
}

const MAX_RETRIES = 10;

async function createTaskFromText(
  prisma: PrismaClient,
  projectId: string,
  creatorId: string,
  title: string,
  description: string,
): Promise<number> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const max = await prisma.task.aggregate({
      where: { projectId },
      _max: { number: true },
    });
    const nextNumber = (max._max.number ?? 0) + 1;
    try {
      const created = await prisma.task.create({
        data: {
          projectId,
          number: nextNumber,
          title,
          description,
          creatorId,
          status: 'BACKLOG',
          priority: 'MEDIUM',
          type: 'TASK',
        },
        select: { number: true },
      });
      return created.number;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 50) * (attempt + 1)));
    }
  }
  throw lastErr ?? new Error('task number conflict');
}

export function registerProjectTelegram(bot: Bot, redis: Redis, prisma: PrismaClient) {
  bot.command('linkproj', async (ctx) => {
    const chat = ctx.chat;
    if (!chat || chat.type === 'private') {
      await ctx.reply(
        'Эту команду нужно отправить в группе или супергруппе, куда добавлен бот:\n/linkproj TG-XXXXXX',
      );
      return;
    }
    const actor = await findPairedUser(prisma, ctx);
    if (!actor) {
      await ctx.reply('Сначала привяжи личку к учётке: /pair TG-… из веба.');
      return;
    }

    const rawArg = (ctx.match || '').toString().trim();
    const codeKey = rawArg.toUpperCase().replace(/^TG-/, '');
    if (!codeKey) {
      await ctx.reply('Использование: /linkproj TG-XXXXXX (код из веба проекта)');
      return;
    }

    const payload = await redis.get(`tg:plink:${codeKey}`);
    if (!payload) {
      await ctx.reply('Код не найден или истёк. Сгенерируй новый на странице проекта → Telegram.');
      return;
    }

    let parsed: { projectId: string; userId: string };
    try {
      parsed = JSON.parse(payload) as { projectId: string; userId: string };
    } catch {
      await ctx.reply('Битый код, сгенерируй новый.');
      return;
    }

    if (parsed.userId !== actor.id) {
      await ctx.reply('Этот код выпустил другой пользователь. Зайди в веб под своей учёткой и сгенерируй код заново.');
      return;
    }

    const project = await loadProject(prisma, parsed.projectId);
    if (!project) {
      await ctx.reply('Проект не найден.');
      return;
    }
    if (!harvestAllowed(actor, project)) {
      await ctx.reply('Недостаточно прав для привязки чата к этому проекту.');
      return;
    }

    const telegramChatId = String(chat.id);
    const chatTitle = 'title' in chat ? chat.title ?? null : null;

    await prisma.projectTelegramChat.upsert({
      where: { telegramChatId },
      create: {
        projectId: project.id,
        telegramChatId,
        chatTitle,
        linkedByUserId: actor.id,
      },
      update: {
        projectId: project.id,
        chatTitle,
        linkedByUserId: actor.id,
      },
    });

    await redis.del(`tg:plink:${codeKey}`);
    await ctx.reply(
      [
        `✅ Чат привязан к проекту ${project.key}.`,
        `Пишите задачи обычными сообщениями — бот их копит.`,
        `Команда /harvest (или /harvest 40) создаёт задачи из последних сообщений.`,
      ].join('\n'),
    );
  });

  bot.command('harvest', async (ctx) => {
    const chat = ctx.chat;
    if (!chat || chat.type === 'private') {
      await ctx.reply('/harvest нужно вызывать в привязанном групповом чате.');
      return;
    }
    const actor = await findPairedUser(prisma, ctx);
    if (!actor) {
      await ctx.reply('Сначала привяжи личку к учётке: /pair TG-… из веба.');
      return;
    }

    const telegramChatId = String(chat.id);
    const link = await prisma.projectTelegramChat.findUnique({
      where: { telegramChatId },
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
      await ctx.reply('Этот чат не привязан к проекту. /linkproj TG-…');
      return;
    }

    if (!harvestAllowed(actor, link.project)) {
      await ctx.reply('Недостаточно прав создавать задачи в этом проекте.');
      return;
    }

    const arg = (ctx.match || '').toString().trim();
    const limit = Math.min(100, Math.max(1, parseInt(arg, 10) || 25));

    const rows = await prisma.telegramProjectMessage.findMany({
      where: { linkId: link.id, harvestedAt: null },
      orderBy: { capturedAt: 'desc' },
      take: limit,
    });

    if (!rows.length) {
      await ctx.reply('В буфере нет неразобранных сообщений (или они уже собраны).');
      return;
    }

    const chronological = [...rows].reverse();
    const created: number[] = [];
    const now = new Date();

    for (const row of chronological) {
      const full = row.text.trim();
      if (full.length < 2) continue;
      const firstLine = full.split(/\r?\n/).find((line: string) => line.trim()) ?? full;
      const title = firstLine.trim().slice(0, 220);
      if (!title) continue;
      const description = full.slice(0, 12000);

      try {
        const num = await createTaskFromText(prisma, link.project.id, actor.id, title, description);
        created.push(num);
        await prisma.telegramProjectMessage.update({
          where: { id: row.id },
          data: { harvestedAt: now },
        });
      } catch {
        // eslint-disable-next-line no-console
        console.error('[tg-bot] harvest row failed', row.id);
      }
    }

    if (!created.length) {
      await ctx.reply('Не удалось создать задачи из буфера (пустой текст?).');
      return;
    }

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
      where: { telegramChatId },
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
}
