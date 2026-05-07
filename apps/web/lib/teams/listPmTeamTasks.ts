import { prisma, type TaskStatus } from '@giper/db';

export type PmTeamTaskFilter = {
  status?: TaskStatus;
  /** Only tasks where this specific team member is assigned (legacy or multi). */
  memberId?: string;
  /** Only Bitrix-mirror or only-local tasks. Empty = both. */
  source?: 'bitrix' | 'local';
  /** Only tasks not in DONE/CANCELED. Default true — usually you want active. */
  onlyOpen?: boolean;
};

/**
 * Tasks across all projects where someone in the PM's roster is doing
 * the work. Two paths get unioned:
 *   - legacy primary assigneeId (Bitrix-mirror also writes here)
 *   - multi-role TaskAssignment (frontend + backend + QA on the same task)
 *
 * The PM might not have project membership on the parent — that's the
 * whole point. We don't gate on canViewProject; the PM/ADMIN role
 * already implies global view per existing rules.
 *
 * Ordering: most-recently-updated first — gives the PM "what's hot
 * right now" without manual sort UI.
 */
export async function listPmTeamTasks(
  pmId: string,
  filter: PmTeamTaskFilter = {},
) {
  // 1. Resolve the PM's team. ADMIN sees everyone — kept consistent with
  //    listTeamMembers. We pass the resolved memberIds to the task query.
  const teamRows = await prisma.pmTeamMember.findMany({
    where: { pmId },
    select: { memberId: true },
  });
  const memberIds = new Set(teamRows.map((r) => r.memberId));
  if (filter.memberId) {
    if (!memberIds.has(filter.memberId)) return [];
    memberIds.clear();
    memberIds.add(filter.memberId);
  }
  if (memberIds.size === 0) return [];
  const ids = [...memberIds];

  const onlyOpen = filter.onlyOpen ?? true;
  const statusClause = filter.status
    ? { status: filter.status }
    : onlyOpen
      ? { status: { notIn: ['DONE', 'CANCELED'] as TaskStatus[] } }
      : {};

  const sourceClause =
    filter.source === 'bitrix'
      ? { externalSource: 'bitrix24' }
      : filter.source === 'local'
        ? { externalSource: null }
        : {};

  const tasks = await prisma.task.findMany({
    where: {
      ...statusClause,
      ...sourceClause,
      OR: [
        { assigneeId: { in: ids } },
        { assignments: { some: { userId: { in: ids } } } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    take: 200,
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      internalStatus: true,
      priority: true,
      dueDate: true,
      updatedAt: true,
      externalSource: true,
      externalId: true,
      project: { select: { id: true, key: true, name: true } },
      assignee: { select: { id: true, name: true, image: true } },
      assignments: {
        select: {
          id: true,
          position: true,
          user: { select: { id: true, name: true, image: true } },
        },
      },
    },
  });

  return tasks;
}

export type PmTeamTaskRow = Awaited<ReturnType<typeof listPmTeamTasks>>[number];
