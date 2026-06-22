import { prisma } from '@giper/db';

/** Sentinel email for the synthetic "AI" user. */
export const AI_BOT_EMAIL = 'ai-bot@giper.local';

/**
 * The synthetic "AI" user. Tasks created and implemented by the AI agent (over
 * MCP) are assigned to it, so the assignee column honestly reflects that an AI
 * did the work — not whichever human's API token happened to drive the MCP call.
 *
 * Unlike the inert Bitrix bot ([[bitrix24/botUser]]), this one is **active** and
 * a normal MEMBER so it renders cleanly on cards and shows up in assignee/mention
 * pickers (you can also assign work to it by hand). It is password-less, so it
 * can never log in (Credentials auth requires a passwordHash).
 *
 * Upsert is race-safe (the unique email collapses concurrent calls).
 */
export async function getAiBotUserId(): Promise<string> {
  const bot = await prisma.user.upsert({
    where: { email: AI_BOT_EMAIL },
    update: {},
    create: {
      email: AI_BOT_EMAIL,
      name: 'AI',
      role: 'MEMBER',
      isActive: true,
    },
    select: { id: true },
  });
  return bot.id;
}

/**
 * Ensure the AI bot exists AND is a member of the given project, then return its
 * id. createTask/assign validates that an assignee is a project member, so the
 * bot has to be enrolled before it can be set as исполнитель. Idempotent.
 */
export async function ensureAiBotAssignee(projectId: string): Promise<string> {
  const botId = await getAiBotUserId();
  await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId, userId: botId } },
    update: {},
    create: { projectId, userId: botId, role: 'CONTRIBUTOR' },
  });
  return botId;
}
