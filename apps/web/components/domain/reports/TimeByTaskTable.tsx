import Link from 'next/link';
import { TaskStatusBadge } from '../TaskStatusBadge';

type Row = {
  id: string;
  number: number;
  title: string;
  status: string;
  estimateHours: number | null;
  hours: number;
  contributorCount: number;
  project: { key: string; name: string };
};

/**
 * "Куда уходит время" report section. One row per task with the
 * largest time-spend at the top. Each row links straight to the task
 * detail page so the report-viewer can drill in without losing context.
 *
 * Columns:
 *   - Задача — KEY-N + title (link)
 *   - Проект — key + name
 *   - Часов — sum across the visible period and the selected scope
 *   - vs Оценка — when an estimate exists, shows percentage; coloured
 *     red if over, amber if 80-100%, otherwise muted. No estimate ⇒ "—".
 *   - Участников — distinct people who logged time on this task
 *   - Статус — внутренний статус через TaskStatusBadge
 *
 * `untrackedHours > 0` renders a small "+ X ч без задачи" hint at the
 * top so the totals don't look fishy when manual logs are unattached.
 */
export function TimeByTaskTable({
  rows,
  untrackedHours,
}: {
  rows: Row[];
  untrackedHours: number;
}) {
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Нет списаний за выбранный период.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {untrackedHours > 0 ? (
        <p className="text-xs text-muted-foreground">
          + {untrackedHours} ч списано без привязки к задаче.
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-2 py-2 font-medium">Задача</th>
              <th className="px-2 py-2 font-medium">Проект</th>
              <th className="px-2 py-2 text-right font-medium">Часов</th>
              <th className="px-2 py-2 text-right font-medium">vs Оценка</th>
              <th className="px-2 py-2 text-right font-medium whitespace-nowrap">
                Участников
              </th>
              <th className="px-2 py-2 font-medium">Статус</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const ratio =
                r.estimateHours && r.estimateHours > 0
                  ? r.hours / r.estimateHours
                  : null;
              const ratioCls =
                ratio == null
                  ? 'text-muted-foreground'
                  : ratio > 1
                    ? 'text-red-600 font-medium'
                    : ratio >= 0.8
                      ? 'text-amber-600'
                      : 'text-muted-foreground';
              return (
                <tr key={r.id} className="border-b border-border/50 align-top">
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
                  <td className="px-2 py-1.5 text-xs">
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">
                      {r.project.key}
                    </span>{' '}
                    <span className="text-muted-foreground">{r.project.name}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.hours}</td>
                  <td className={'px-2 py-1.5 text-right tabular-nums ' + ratioCls}>
                    {ratio == null
                      ? '—'
                      : ratio > 1
                        ? `+${Math.round((ratio - 1) * 100)}%`
                        : `${Math.round(ratio * 100)}%`}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                    {r.contributorCount}
                  </td>
                  <td className="px-2 py-1.5">
                    <TaskStatusBadge
                      status={r.status as Parameters<typeof TaskStatusBadge>[0]['status']}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
