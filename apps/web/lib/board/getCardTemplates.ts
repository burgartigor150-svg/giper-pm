import { prisma } from '@giper/db';

export type CardTemplateView = {
  id: string;
  name: string;
  title: string;
  description: string;
  type: 'TASK' | 'BUG' | 'FEATURE' | 'EPIC' | 'CHORE';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  order: number;
};

/**
 * Load a project's card templates, ordered for the picker. Fault-tolerant:
 * if the table isn't there yet (image live a beat before migrate deploy) we
 * return [] so the board / settings never 500 over templates.
 */
export async function getCardTemplates(projectId: string): Promise<CardTemplateView[]> {
  try {
    return await prisma.cardTemplate.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        name: true,
        title: true,
        description: true,
        type: true,
        priority: true,
        order: true,
      },
    });
  } catch (e) {
    console.warn('getCardTemplates: templates unavailable', e);
    return [];
  }
}
