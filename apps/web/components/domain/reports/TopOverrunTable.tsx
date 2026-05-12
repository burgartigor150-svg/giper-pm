import Link from 'next/link';

type Row = {
  id: string;
  number: number;
  title: string;
  estimateHours: number;
  spentHours: number;
  overrunHours: number;
  overrunPct: number;
  project: { key: string; name: string };
};

/**
 * Top tasks where actual hours exceeded the original estimate the most.
 * Sorted by absolute overrun (hours, not percent) — a 4-hour overrun on
 * a 40-hour task is more important to discuss than a 1-hour overrun on
 * a 1-hour task.
 */
export function TopOverrunTable({ rows }: { rows: Row[] }) {
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Нет задач с перерасходом за период. Хорошо живём.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr className="border-b border-border">
            <th className="px-2 py-2 font-medium">Задача</th>
            <th className="px-2 py-2 text-right font-medium">Оценка</th>
            <th className="px-2 py-2 text-right font-medium">Факт</th>
            <th className="px-2 py-2 text-right font-medium">+Часов</th>
            <th className="px-2 py-2 text-right font-medium">+%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border/50">
              <td className="px-2 py-1.5">
                <Link
                  href={`/projects/${r.project.key}/tasks/${r.number}`}
                  className="hover:underline"
                >
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {r.project.key}-{r.number}
                  </span>{' '}
                  {r.title}
                </Link>
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">{r.estimateHours}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{r.spentHours}</td>
              <td className="px-2 py-1.5 text-right font-medium tabular-nums text-red-600">
                +{r.overrunHours}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums text-red-600">
                +{r.overrunPct}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
