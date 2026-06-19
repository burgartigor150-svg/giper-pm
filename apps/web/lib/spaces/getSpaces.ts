import { prisma } from '@giper/db';

export type SpaceView = {
  id: string;
  name: string;
  description: string | null;
  order: number;
  color: string | null;
  projectCount: number;
};

/**
 * Active (non-archived) spaces with project counts, ordered for the manager
 * and the grouped projects list. Fault-tolerant: returns [] if the table isn't
 * there yet (image live a beat before migrate deploy).
 *
 * NOTE: the count here is the TOTAL projects in the space (admin view). The
 * grouped projects LIST must still group the per-stake-visible projects from
 * listProjectsForUser — never query projects unscoped off a space.
 */
export async function getSpaces(): Promise<SpaceView[]> {
  try {
    const rows = await prisma.space.findMany({
      where: { archivedAt: null },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        order: true,
        color: true,
        _count: { select: { projects: true } },
      },
    });
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      order: s.order,
      color: s.color,
      projectCount: s._count.projects,
    }));
  } catch (e) {
    console.warn('getSpaces: unavailable', e);
    return [];
  }
}
