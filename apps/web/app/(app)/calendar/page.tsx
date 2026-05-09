import { requireAuth } from '@/lib/auth';
import { prisma } from '@giper/db';
import { getDeadlinesInRange } from '@/lib/calendar/getDeadlines';
import { Calendar } from '@/components/domain/Calendar';

type SearchParams = Promise<{
  m?: string; // YYYY-MM (anchor month for month view)
  d?: string; // YYYY-MM-DD (anchor day for week/day view)
  v?: 'month' | 'week' | 'day';
  // Filters
  scope?: 'mine' | 'team';
  proj?: string;
  ass?: string;
  st?: string; // comma-separated status values
}>;

export const dynamic = 'force-dynamic';

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const me = await requireAuth();
  const sp = await searchParams;

  const view = sp.v === 'week' || sp.v === 'day' ? sp.v : 'month';
  const today = new Date();

  // Anchor + visible range depending on view.
  let rangeStart: Date;
  let rangeEnd: Date;
  let anchorIso: string;
  if (view === 'month') {
    const m = sp.m && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : null;
    const year = m ? Number(m.slice(0, 4)) : today.getFullYear();
    const monthIdx = m ? Number(m.slice(5, 7)) - 1 : today.getMonth();
    const first = new Date(year, monthIdx, 1);
    const offset = (first.getDay() + 6) % 7;
    rangeStart = new Date(year, monthIdx, 1 - offset);
    rangeEnd = new Date(year, monthIdx, 1 - offset + 42);
    anchorIso = `${year}-${String(monthIdx + 1).padStart(2, '0')}-01`;
  } else if (view === 'week') {
    const d = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? new Date(sp.d) : today;
    const offset = (d.getDay() + 6) % 7;
    rangeStart = new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset);
    rangeEnd = new Date(rangeStart.getTime() + 7 * 86400_000);
    anchorIso = ymd(rangeStart);
  } else {
    const d = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? new Date(sp.d) : today;
    rangeStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    rangeEnd = new Date(rangeStart.getTime() + 86400_000);
    anchorIso = ymd(rangeStart);
  }

  // Sidebar lookahead: 14 days from today regardless of view.
  const lookaheadStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const lookaheadEnd = new Date(lookaheadStart.getTime() + 14 * 86400_000);

  const filters = {
    scope: sp.scope === 'team' ? ('team' as const) : ('mine' as const),
    projectKey: sp.proj || undefined,
    assigneeId: sp.ass || undefined,
    status: sp.st ? sp.st.split(',').filter(Boolean) : undefined,
  };

  // Scope the project picker the same way the visibility scope works:
  //   - 'mine' (default for everyone) → only projects where the user
  //     actually has tasks (creator/assignee/reviewer/coassignee/watcher).
  //     Otherwise the dropdown lists the whole org (200+ items) and
  //     nothing in it is relevant to the caller.
  //   - 'team' (ADMIN/PM opt-in) → all active projects.
  const projectsPromise =
    filters.scope === 'team' && (me.role === 'ADMIN' || me.role === 'PM')
      ? prisma.project.findMany({
          where: { status: 'ACTIVE' },
          select: { key: true, name: true },
          orderBy: { key: 'asc' },
          take: 500,
        })
      : prisma.project.findMany({
          where: {
            status: 'ACTIVE',
            tasks: {
              some: {
                OR: [
                  { creatorId: me.id },
                  { assigneeId: me.id },
                  { reviewerId: me.id },
                  { assignments: { some: { userId: me.id } } },
                  { watchers: { some: { userId: me.id } } },
                ],
              },
            },
          },
          select: { key: true, name: true },
          orderBy: { key: 'asc' },
        });

  const [items, lookaheadItems, projects] = await Promise.all([
    getDeadlinesInRange(rangeStart, rangeEnd, { id: me.id, role: me.role }, filters),
    getDeadlinesInRange(
      lookaheadStart,
      lookaheadEnd,
      { id: me.id, role: me.role },
      { ...filters, status: ['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW'] },
    ),
    projectsPromise,
  ]);

  // Assignee picker = strictly my team (PmTeamMember rows + me).
  // Used to be derived from items in range, which leaked everyone
  // visible org-wide into the dropdown. The calendar's whole point
  // is "my team" — restrict the picker to that.
  const teamRows = await prisma.pmTeamMember.findMany({
    where: { OR: [{ pmId: me.id }, { memberId: me.id }] },
    select: {
      pm: { select: { id: true, name: true } },
      member: { select: { id: true, name: true } },
    },
  });
  const peerRows = teamRows.length
    ? await prisma.pmTeamMember.findMany({
        where: { pmId: { in: teamRows.map((t) => t.pm.id) } },
        select: { member: { select: { id: true, name: true } } },
      })
    : [];
  const meRow = await prisma.user.findUnique({
    where: { id: me.id },
    select: { id: true, name: true },
  });
  const assigneeMap = new Map<string, { id: string; name: string }>();
  if (meRow) assigneeMap.set(meRow.id, meRow);
  for (const t of teamRows) {
    assigneeMap.set(t.member.id, t.member);
    assigneeMap.set(t.pm.id, t.pm);
  }
  for (const p of peerRows) {
    assigneeMap.set(p.member.id, p.member);
  }
  const assignees = Array.from(assigneeMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return (
    <div className="mx-auto max-w-[1400px]">
      <Calendar
        view={view}
        anchor={anchorIso}
        items={items.map((i) => ({ ...i, dueDate: i.dueDate.toISOString() }))}
        lookahead={lookaheadItems.map((i) => ({
          ...i,
          dueDate: i.dueDate.toISOString(),
        }))}
        currentUserId={me.id}
        currentUserRole={me.role}
        projects={projects}
        assignees={assignees}
        initialFilters={filters}
      />
    </div>
  );
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
