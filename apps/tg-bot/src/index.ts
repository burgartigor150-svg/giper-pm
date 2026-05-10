/**
 * giper-pm Telegram multi-bot runner.
 *
 * There is no longer a single org-wide bot. Each PM connects their own
 * BotFather bot in the web UI ("Интеграции → Telegram"). We poll all
 * `UserTelegramBot` rows where `isActive = true`, one grammY long-polling
 * client per bot.
 *
 * Reconciliation:
 *   - On boot, load all active rows and start a Bot for each.
 *   - Subscribe to Redis pub/sub channel `tg:bots:reload`. Web publishes
 *     `{action: 'add'|'update'|'remove', botId}` whenever a user
 *     connects, edits, or disconnects a bot.
 *   - Safety net: every 60s sweep the DB and reconcile (in case a
 *     pub/sub event was lost or the runner just started).
 *
 * Per-bot handlers live in projectLinkHarvest.ts.
 */

import { Bot } from 'grammy';
import { Redis } from 'ioredis';
import { prisma, type PrismaClient } from '@giper/db';
import { decryptToken } from '@giper/shared/tgTokenCrypto';
import { registerBotHandlers, type OwningBot } from './projectLinkHarvest';
import { startDownloadWorker } from './downloadFiles';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const RECONCILE_INTERVAL_MS = 60_000;
const RELOAD_CHANNEL = 'tg:bots:reload';

type BotEntry = {
  bot: Bot;
  owning: OwningBot;
  startedAt: number;
};

class BotManager {
  private readonly running = new Map<string, BotEntry>();
  private starting = new Set<string>();

  constructor(
    private readonly prismaClient: PrismaClient,
    private readonly redis: Redis,
  ) {}

  async reconcile(): Promise<void> {
    let rows: { id: string; userId: string; botUsername: string; encryptedToken: string }[];
    try {
      rows = await this.prismaClient.userTelegramBot.findMany({
        where: { isActive: true },
        select: {
          id: true,
          userId: true,
          botUsername: true,
          encryptedToken: true,
        },
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[tg-bot] reconcile DB query failed', e);
      return;
    }

    const wanted = new Set(rows.map((r) => r.id));

    for (const id of [...this.running.keys()]) {
      if (!wanted.has(id)) {
        await this.stopBot(id, 'no longer active in DB');
      }
    }

    for (const row of rows) {
      if (this.running.has(row.id) || this.starting.has(row.id)) continue;
      this.starting.add(row.id);
      this.startBot(row).finally(() => {
        this.starting.delete(row.id);
      });
    }
  }

  private async startBot(row: {
    id: string;
    userId: string;
    botUsername: string;
    encryptedToken: string;
  }): Promise<void> {
    let token: string;
    try {
      token = decryptToken(row.encryptedToken);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[tg-bot:${row.botUsername}] decrypt failed`, e);
      await this.markError(row.id, `decrypt failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    const owning: OwningBot = {
      id: row.id,
      userId: row.userId,
      botUsername: row.botUsername,
    };

    const bot = new Bot(token);
    registerBotHandlers(bot, this.redis, this.prismaClient, owning);

    bot.start({
      onStart: (info) => {
        // eslint-disable-next-line no-console
        console.log(`[tg-bot:${info.username}] long-poll started (id=${row.id}, owner=${row.userId})`);
      },
    }).catch(async (err) => {
      // eslint-disable-next-line no-console
      console.error(`[tg-bot:${row.botUsername}] start failed`, err);
      await this.markError(row.id, err instanceof Error ? err.message : String(err));
      this.running.delete(row.id);
    });

    this.running.set(row.id, { bot, owning, startedAt: Date.now() });
    await this.markPolled(row.id);
  }

  private async stopBot(id: string, reason: string): Promise<void> {
    const entry = this.running.get(id);
    if (!entry) return;
    this.running.delete(id);
    try {
      await entry.bot.stop();
      // eslint-disable-next-line no-console
      console.log(`[tg-bot:${entry.owning.botUsername}] stopped (${reason})`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[tg-bot:${entry.owning.botUsername}] stop failed`, e);
    }
  }

  private async markError(botId: string, message: string): Promise<void> {
    try {
      await this.prismaClient.userTelegramBot.update({
        where: { id: botId },
        data: { lastError: message.slice(0, 2000) },
      });
    } catch {
      // best-effort
    }
  }

  private async markPolled(botId: string): Promise<void> {
    try {
      await this.prismaClient.userTelegramBot.update({
        where: { id: botId },
        data: { lastPolledAt: new Date(), lastError: null },
      });
    } catch {
      // best-effort
    }
  }

  count(): number {
    return this.running.size;
  }

  /** Look up the running grammY Bot for a given UserTelegramBot id. */
  getBot(botId: string): Bot | undefined {
    return this.running.get(botId)?.bot;
  }

  async stopAll(): Promise<void> {
    for (const id of [...this.running.keys()]) {
      await this.stopBot(id, 'shutdown');
    }
  }
}

// --------------------------- Boot ------------------------------------

(async () => {
  const redis = new Redis(REDIS_URL, { lazyConnect: true });
  // Separate connection for pub/sub: ioredis subscribers can't issue
  // other commands on the same socket.
  const subRedis = new Redis(REDIS_URL, { lazyConnect: true });

  await redis.connect();
  await subRedis.connect();

  const manager = new BotManager(prisma, redis);

  await subRedis.subscribe(RELOAD_CHANNEL);
  subRedis.on('message', (channel, raw) => {
    if (channel !== RELOAD_CHANNEL) return;
    // eslint-disable-next-line no-console
    console.log('[tg-bot] received reload event:', raw);
    manager.reconcile().catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[tg-bot] reconcile after pub/sub failed', e);
    });
  });

  await manager.reconcile();
  // eslint-disable-next-line no-console
  console.log(`[tg-bot] boot complete; ${manager.count()} bot(s) running`);

  // AI-harvest file download worker (separate pub/sub channel).
  await startDownloadWorker(subRedis, prisma, (botId) => manager.getBot(botId));

  setInterval(() => {
    manager.reconcile().catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[tg-bot] periodic reconcile failed', e);
    });
  }, RECONCILE_INTERVAL_MS);

  const shutdown = async (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`[tg-bot] ${signal} received, shutting down`);
    await manager.stopAll();
    await subRedis.quit().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
})().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[tg-bot] fatal', err);
  process.exit(1);
});
