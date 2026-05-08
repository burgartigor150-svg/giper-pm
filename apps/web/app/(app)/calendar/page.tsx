import { requireAuth } from '@/lib/auth';
import { getDeadlinesInRange } from '@/lib/calendar/getDeadlines';
import { CalendarMonth } from '@/components/domain/CalendarMonth';

type SearchParams = Promise<{ m?: string }>;

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const me = await requireAuth();
  const sp = await searchParams;

  // ?m=YYYY-MM. Default = current month.
  const m = sp.m && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : null;
  const today = new Date();
  const year = m ? Number(m.slice(0, 4)) : today.getFullYear();
  const monthIdx = m ? Number(m.slice(5, 7)) - 1 : today.getMonth();

  // Range covers the visible 6-week grid (Mon before the 1st → Mon after).
  const first = new Date(year, monthIdx, 1);
  const offset = (first.getDay() + 6) % 7;
  const gridStart = new Date(year, monthIdx, 1 - offset);
  const gridEnd = new Date(year, monthIdx, 1 - offset + 42);

  const items = await getDeadlinesInRange(gridStart, gridEnd, {
    id: me.id,
    role: me.role,
  });
  const monthStart = `${year}-${String(monthIdx + 1).padStart(2, '0')}-01`;

  return (
    <div className="mx-auto max-w-6xl">
      <CalendarMonth
        monthStart={monthStart}
        items={items.map((i) => ({ ...i, dueDate: i.dueDate.toISOString() }))}
      />
    </div>
  );
}
