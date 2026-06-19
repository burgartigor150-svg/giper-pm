import { prisma } from '@giper/db';

export type ApiTokenView = {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

/** A user's API tokens for the management UI. Never returns the hash. */
export async function getApiTokens(userId: string): Promise<ApiTokenView[]> {
  try {
    return await prisma.apiToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        prefix: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
  } catch (e) {
    console.warn('getApiTokens: unavailable', e);
    return [];
  }
}
