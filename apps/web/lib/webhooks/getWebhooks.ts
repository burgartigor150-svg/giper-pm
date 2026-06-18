import { prisma } from '@giper/db';

export type WebhookView = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  lastStatus: number | null;
  lastError: string | null;
  lastFiredAt: Date | null;
};

/**
 * Webhooks for a project's settings UI. Never returns the signing secret.
 * Fault-tolerant: returns [] if the table isn't there yet.
 */
export async function getWebhooks(projectId: string): Promise<WebhookView[]> {
  try {
    return await prisma.webhook.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        url: true,
        events: true,
        active: true,
        lastStatus: true,
        lastError: true,
        lastFiredAt: true,
      },
    });
  } catch (e) {
    console.warn('getWebhooks: unavailable', e);
    return [];
  }
}
