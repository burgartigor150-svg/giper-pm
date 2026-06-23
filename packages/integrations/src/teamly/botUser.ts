import type { PrismaClient } from '@giper/db';

/** Sentinel email for the synthetic TEAMLY author. */
export const TEAMLY_BOT_EMAIL = 'teamly-bot@giper.local';

/**
 * Synthetic "TEAMLY" author for imported articles whose TEAMLY author can't be
 * matched to a real giper-pm user (by email). Inactive VIEWER so it never logs
 * in or appears in pickers, but keeps imported content attributed to a stable,
 * recognisable identity instead of a real person.
 */
export async function getTeamlyBotUserId(prisma: PrismaClient): Promise<string> {
  const bot = await prisma.user.upsert({
    where: { email: TEAMLY_BOT_EMAIL },
    update: {},
    create: { email: TEAMLY_BOT_EMAIL, name: 'TEAMLY', role: 'VIEWER', isActive: false },
    select: { id: true },
  });
  return bot.id;
}
