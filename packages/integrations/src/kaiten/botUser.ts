import type { PrismaClient } from '@giper/db';

/** Sentinel email for the synthetic Kaiten author. */
export const KAITEN_BOT_EMAIL = 'kaiten-bot@giper.local';

/**
 * Synthetic "Kaiten" author for imported cards. Kaiten user ids don't map to
 * local users (no shared identity), so imported tasks are attributed to this
 * inactive VIEWER instead of a real person.
 */
export async function getKaitenBotUserId(prisma: PrismaClient): Promise<string> {
  const bot = await prisma.user.upsert({
    where: { email: KAITEN_BOT_EMAIL },
    update: {},
    create: { email: KAITEN_BOT_EMAIL, name: 'Kaiten', role: 'VIEWER', isActive: false },
    select: { id: true },
  });
  return bot.id;
}
