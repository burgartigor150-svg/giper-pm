/**
 * giper-pm Telegram bot. Long-polling (no public webhook needed),
 * minimal command surface for phase 2 of ROADMAP.md:
 *
 *   /pair <CODE>     — link this Telegram chat to a giper-pm User.
 *                      Code is generated on the web at
 *                      /settings/integrations/telegram and lives in
 *                      Redis for 5 minutes.
 *   /me              — show who you're paired as + active timer state.
 *   /today           — sum of hours logged today.
 *   /week            — sum of hours logged Mon..now.
 *   /stop            — stop the active live timer (no-op if none).
 *   /log <h> <KEY-N> [note] — append a manual TimeEntry on a task.
 *   /help            — list of commands.
 *
 * Auth model: every command (except /pair and /help) resolves the
 * caller via User.tgChatId. Without a pairing the bot replies with
 * "open /settings/integrations/telegram in the web to get a code".
 */

import { Bot, type Context } from 'grammy';
import { Redis } from 'ioredis';
import { prisma } from '@giper/db';

const TG_BOT_TOKEN = requireEnv('TG_BOT_TOKEN');
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? '';

const redis = new Redis(REDIS_URL, { lazyConnect: true });
const bot = new Bot(TG_BOT_TOKEN);

// --------------------------- Helpers ---------------------------------

async function findUserByChat(chatId: number): Promise<{
  id: string;
  name: string;
  role: string;
} | null> {
  return prisma.user.findUnique({
    where: { tgChatId: String(chatId) },
    select: { id: true, name: true, role: true },
  });
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(): Date {
  const d = startOfToday();
  // Monday-based week.
  const dow = d.getDay() || 7;
  d.setDate(d.getDate() - (dow - 1));
  return d;
}

function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m}м`;
  if (!m) return `${h}ч`;
  return `${h}ч ${m}м`;
}

async function requirePaired(ctx: Context): Promise<{
  id: string;
  name: string;
} | null> {
  if (!ctx.chat) return null;
  const u = await findUserByChat(ctx.chat.id);
  if (!u) {
    const where = PUBLIC_BASE_URL
      ? `${PUBLIC_BASE_URL}/settings/integrations/telegram`
      : 'веб-приложении (Настройки → Интеграции → Telegram)';
    await ctx.reply(
      `Этот чат пока не привязан. Получи одноразовый код в ${where} ` +
        `и пришли мне:\n\n/pair TG-XXXXXX`,
    );
    return null;
  }
  return u;
}

// --------------------------- Commands --------------------------------

bot.command('start', async (ctx) => {
  const arg = (ctx.match || '').toString().trim();
  if (arg.toUpperCase().startsWith('TG-')) {
    return pair(ctx, arg);
  }
  await ctx.reply(
    [
      'Привет! Я бот giper-pm.',
      '',
      'Команды:',
      '/pair TG-XXXXXX — привязать чат к учётке (код возьми в вебе)',
      '/me — кто ты + текущий таймер',
      '/today — часы за сегодня',
      '/week — часы за неделю',
      '/stop — остановить активный live-таймер',
      '/log 1.5 GFM-42 что делал — записать время вручную',
      '/help — повторить эту шпаргалку',
    ].join('\n'),
  );
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    [
      'Команды:',
      '/pair TG-XXXXXX — привязать чат',
      '/me — текущий статус',
      '/today, /week — отчёты',
      '/stop — остановить таймер',
      '/log 1.5 GFM-42 заметка — лог времени',
    ].join('\n'),
  );
});

bot.command('pair', async (ctx) => {
  const code = (ctx.match || '').toString().trim();
  if (!code) {
    await ctx.reply('Использование: /pair TG-XXXXXX');
    return;
  }
  await pair(ctx, code);
});

async function pair(ctx: Context, rawCode: string) {
  if (!ctx.chat || !ctx.from) return;
  const code = rawCode.toUpperCase().replace(/^TG-/, '');
  const userId = await redis.get(`tg:pair:${code}`);
  if (!userId) {
    await ctx.reply('Код не найден или истёк. Сгенерируй новый в вебе.');
    return;
  }
  // Bind tgChatId → user. We also wipe any other chat that might be
  // pointing at this user (one-to-one is the only sane model here).
  await prisma.user.updateMany({
    where: { tgChatId: String(ctx.chat.id), NOT: { id: userId } },
    data: { tgChatId: null },
  });
  const tgUsername = ctx.from.username ?? null;
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { tgChatId: String(ctx.chat.id), tgUsername },
    select: { name: true },
  });
  await redis.del(`tg:pair:${code}`);
  await ctx.reply(`Готово, привязан как ${updated.name}. Команды: /help`);
}

bot.command('me', async (ctx) => {
  const u = await requirePaired(ctx);
  if (!u) return;
  const active = await prisma.timeEntry.findFirst({
    where: { userId: u.id, endedAt: null, source: 'MANUAL_TIMER' },
    select: {
      startedAt: true,
      task: {
        select: { number: true, title: true, project: { select: { key: true } } },
      },
    },
  });
  if (!active) {
    await ctx.reply(`Ты ${u.name}. Активного таймера нет.`);
    return;
  }
  const elapsedMin = Math.floor((Date.now() - active.startedAt.getTime()) / 60_000);
  const taskRef = active.task
    ? `${active.task.project.key}-${active.task.number} — ${active.task.title}`
    : '(без задачи)';
  await ctx.reply(
    `Ты ${u.name}.\nИдёт таймер: ${fmtMin(elapsedMin)} на ${taskRef}.`,
  );
});

bot.command('today', async (ctx) => {
  const u = await requirePaired(ctx);
  if (!u) return;
  await replyTotal(ctx, u.id, startOfToday(), 'сегодня');
});

bot.command('week', async (ctx) => {
  const u = await requirePaired(ctx);
  if (!u) return;
  await replyTotal(ctx, u.id, startOfWeek(), 'эту неделю');
});

async function replyTotal(
  ctx: Context,
  userId: string,
  from: Date,
  label: string,
) {
  const rows = await prisma.timeEntry.findMany({
    where: { userId, startedAt: { gte: from } },
    select: { durationMin: true, startedAt: true, endedAt: true },
  });
  let total = 0;
  for (const r of rows) {
    if (r.durationMin != null) {
      total += r.durationMin;
    } else {
      // Live timer: count elapsed.
      total += Math.max(
        0,
        Math.floor((Date.now() - r.startedAt.getTime()) / 60_000),
      );
    }
  }
  await ctx.reply(`За ${label}: ${fmtMin(total)} (${rows.length} записей)`);
}

bot.command('stop', async (ctx) => {
  const u = await requirePaired(ctx);
  if (!u) return;
  const active = await prisma.timeEntry.findFirst({
    where: { userId: u.id, endedAt: null, source: 'MANUAL_TIMER' },
    select: { id: true, startedAt: true, note: true },
  });
  if (!active) {
    await ctx.reply('Активного таймера нет.');
    return;
  }
  const endedAt = new Date();
  const durationMin = Math.max(
    1,
    Math.round((endedAt.getTime() - active.startedAt.getTime()) / 60_000),
  );
  await prisma.timeEntry.update({
    where: { id: active.id },
    data: { endedAt, durationMin },
  });
  await ctx.reply(`Таймер остановлен: ${fmtMin(durationMin)}.`);
});

const LOG_RE = /^\s*([\d]+(?:[.,]\d+)?)\s+([A-Z][A-Z0-9]{1,4})-(\d+)\s*(.*)$/i;

bot.command('log', async (ctx) => {
  const u = await requirePaired(ctx);
  if (!u) return;
  const m = LOG_RE.exec((ctx.match || '').toString());
  if (!m) {
    await ctx.reply('Использование: /log <часы> KEY-NUMBER <заметка>\nПример: /log 1.5 GFM-42 fixed bug');
    return;
  }
  const hours = Number(m[1]!.replace(',', '.'));
  const projectKey = m[2]!.toUpperCase();
  const taskNumber = Number(m[3]);
  const note = (m[4] || '').trim() || null;
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
    await ctx.reply('Часы должны быть в диапазоне 0..24');
    return;
  }
  const project = await prisma.project.findUnique({
    where: { key: projectKey },
    select: { id: true },
  });
  if (!project) {
    await ctx.reply(`Проект ${projectKey} не найден.`);
    return;
  }
  const task = await prisma.task.findUnique({
    where: { projectId_number: { projectId: project.id, number: taskNumber } },
    select: { id: true },
  });
  if (!task) {
    await ctx.reply(`Задача ${projectKey}-${taskNumber} не найдена.`);
    return;
  }
  const minutes = Math.max(1, Math.round(hours * 60));
  // Pin start at 09:00 today so the entry shows clustered with the
  // morning block in /me timeline (matches the web "Залогать часы"
  // affordance).
  const startedAt = new Date();
  startedAt.setHours(9, 0, 0, 0);
  const endedAt = new Date(startedAt.getTime() + minutes * 60_000);
  await prisma.timeEntry.create({
    data: {
      userId: u.id,
      taskId: task.id,
      startedAt,
      endedAt,
      durationMin: minutes,
      source: 'TELEGRAM',
      note,
    },
  });
  await ctx.reply(`Записал ${fmtMin(minutes)} на ${projectKey}-${taskNumber}.`);
});

bot.catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[tg-bot] unhandled', err);
});

// --------------------------- Boot ------------------------------------

(async () => {
  await redis.connect();
  // eslint-disable-next-line no-console
  console.log('[tg-bot] starting long-poll…');
  await bot.start({
    onStart: (info) => {
      // eslint-disable-next-line no-console
      console.log(`[tg-bot] connected as @${info.username}`);
    },
  });
})().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[tg-bot] fatal', err);
  process.exit(1);
});

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    // eslint-disable-next-line no-console
    console.error(`[tg-bot] FATAL: ${name} is required`);
    process.exit(1);
  }
  return v;
}
