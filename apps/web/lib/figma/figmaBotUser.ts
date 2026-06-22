import { prisma } from '@giper/db';

/** Sentinel email for the synthetic "Figma" comment author. */
export const FIGMA_BOT_EMAIL = 'figma-bot@giper.local';

/**
 * Synthetic author for comments mirrored from Figma — like the Bitrix bot
 * ([[bitrix24/botUser]]). Inactive + password-less so it never logs in or
 * appears in pickers; the real Figma commenter's handle goes in the body.
 */
export async function getFigmaBotUserId(): Promise<string> {
  const bot = await prisma.user.upsert({
    where: { email: FIGMA_BOT_EMAIL },
    update: {},
    create: { email: FIGMA_BOT_EMAIL, name: 'Figma', role: 'VIEWER', isActive: false },
    select: { id: true },
  });
  return bot.id;
}
