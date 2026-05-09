import { requireAuth } from '@/lib/auth';
import { prisma } from '@giper/db';
import { getDeadlinesInRange } from '@/lib/calendar/getDeadlines';
import { Calendar } from '@/components/domain/Calendar';

type SearchParams = Promise<{
  m?: string; // YYYY-MM (anchor month for month view)
  d?: string; // YYYY-MM-DD (anchor day for week/day view)
  v?: 'month' | 'week' | 'day';
  // Filters
  mine?: '1';
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
    myOnly: sp.mine === '1',
    projectKey: sp.proj || undefined,
    assigneeId: sp.ass || undefined,
    status: sp.st ? sp.st.split(',').filter(Boolean) : undefined,
  };

  const [items, lookaheadItems, projects] = await Promise.all([
    getDeadlinesInRange(rangeStart, rangeEnd, { id: me.id, role: me.role }, filters),
    getDeadlinesInRange(
      lookaheadStart,
      lookaheadEnd,
      { id: me.id, role: me.role },
      { ...filters, status: ['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW'] },
    ),
    prisma.project.findMany({
      where: { status: 'ACTIVE' },
      select: { key: true, name: true },
      orderBy: { key: 'asc' },
      take: 200,
    }),
  ]);

  // Assignees seen across both ranges → quick picker for the Filter
  // bar (no need for full-org search just to filter the calendar).
  const assigneeMap = new Map<string, { id: string; name: string }>();
  for (const it of [...items, ...lookaheadItems]) {
    if (it.assignee) assigneeMap.set(it.assignee.id, it.assignee);
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
