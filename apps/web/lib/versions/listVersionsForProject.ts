import { prisma } from '@giper/db';

export type VersionRow = {
  id: string;
  name: string;
  description: string | null;
  status: 'PLANNED' | 'RELEASED' | 'ARCHIVED';
  releaseDate: Date | null;
  releasedAt: Date | null;
  /** Total cards slated for this version. */
  taskCount: number;
  /** Cards in internalStatus DONE — drives the release progress bar. */
  doneCount: number;
};

/**
 * Versions for a project with per-version progress counts. Caller is responsible
 * for the project view-floor (the /releases page enforces it via getProject).
 * Ordering: PLANNED first, then by release date, then creation — upcoming work on top.
 */
export async function listVersionsForProject(projectId: string): Promise<VersionRow[]> {
  const versions = await prisma.version.findMany({
    where: { projectId },
    orderBy: [{ status: 'asc' }, { releaseDate: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      releaseDate: true,
      releasedAt: true,
    },
  });
  if (versions.length === 0) return [];

  const ids = versions.map((v) => v.id);
  const [totals, dones] = await Promise.all([
    // Denominator excludes CANCELED so a release with canceled cards can still
    // reach 100% — matches the burndown convention (CANCELED is not "open work").
    prisma.task.groupBy({
      by: ['versionId'],
      where: { versionId: { in: ids }, internalStatus: { not: 'CANCELED' } },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ['versionId'],
      where: { versionId: { in: ids }, internalStatus: 'DONE' },
      _count: { _all: true },
    }),
  ]);
  const totalMap = new Map(totals.map((t) => [t.versionId, t._count._all]));
  const doneMap = new Map(dones.map((d) => [d.versionId, d._count._all]));

  return versions.map((v) => ({
    ...v,
    taskCount: totalMap.get(v.id) ?? 0,
    doneCount: doneMap.get(v.id) ?? 0,
  }));
}
