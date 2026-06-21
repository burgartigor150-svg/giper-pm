import type { PrismaClient } from '@giper/db';

/** Sentinel email for the synthetic Bitrix author. */
export const BITRIX_BOT_EMAIL = 'bitrix24-bot@giper.local';

/**
 * The synthetic "Bitrix24" author used for mirrored comments / history events
 * whose Bitrix author can't be matched to a real giper-pm user — i.e. the b24
 * robot, business-process automations, or users not (yet) synced to us.
 *
 * Previously these fell back to the first active ADMIN, so every robot/system
 * comment was wrongly attributed to a real person (the admin). Pinning them on
 * this inert bot instead keeps the timeline honest. The bot is inactive and
 * password-less → it never logs in and never shows up in member pickers.
 *
 * Upsert is race-safe (the unique email collapses concurrent sync runs).
 */
export async function getBitrixBotUserId(prisma: PrismaClient): Promise<string> {
  const bot = await prisma.user.upsert({
    where: { email: BITRIX_BOT_EMAIL },
    update: {},
    create: {
      email: BITRIX_BOT_EMAIL,
      name: 'Bitrix24',
      role: 'VIEWER',
      isActive: false,
    },
    select: { id: true },
  });
  return bot.id;
}
