import { prisma } from '@giper/db';

export type ComponentRow = {
  id: string;
  name: string;
  description: string | null;
  lead: { id: string; name: string } | null;
  /** Cards assigned to this component. */
  taskCount: number;
};

/**
 * Components for a project with per-component card counts. Caller enforces the
 * project view-floor (settings/board/list pages already do).
 */
export async function listComponentsForProject(projectId: string): Promise<ComponentRow[]> {
  const components = await prisma.component.findMany({
    where: { projectId },
    orderBy: [{ name: 'asc' }],
    select: {
      id: true,
      name: true,
      description: true,
      lead: { select: { id: true, name: true } },
    },
  });
  if (components.length === 0) return [];

  const ids = components.map((c) => c.id);
  const totals = await prisma.task.groupBy({
    by: ['componentId'],
    where: { componentId: { in: ids } },
    _count: { _all: true },
  });
  const totalMap = new Map(totals.map((t) => [t.componentId, t._count._all]));

  return components.map((c) => ({ ...c, taskCount: totalMap.get(c.id) ?? 0 }));
}
