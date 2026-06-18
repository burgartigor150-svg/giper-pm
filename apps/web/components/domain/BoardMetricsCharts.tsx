'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { tokens } from '@giper/ui';
import type { BoardMetrics } from '@/lib/board/getBoardMetrics';

const STATUS_LABEL: Record<string, string> = {
  BACKLOG: 'Бэклог',
  TODO: 'К работе',
  IN_PROGRESS: 'В работе',
  REVIEW: 'На ревью',
  BLOCKED: 'Заблок.',
  DONE: 'Готово',
  CANCELED: 'Отменена',
};

function fmtWeek(iso: string): string {
  // iso = YYYY-MM-DD (Monday) → DD.MM
  const [, m, d] = iso.split('-');
  return `${d}.${m}`;
}

/** Throughput (completed/week) + current WIP per column, recharts bars. */
export function BoardMetricsCharts({ metrics }: { metrics: BoardMetrics }) {
  const tp = metrics.throughput.map((p) => ({ ...p, label: fmtWeek(p.week) }));
  const tpTotal = tp.reduce((s, p) => s + p.count, 0);
  const tpSummary = `Завершено за 8 недель: ${tpTotal}`;

  const wip = metrics.wip.map((w) => ({
    ...w,
    label: STATUS_LABEL[w.status] ?? w.status,
  }));
  const wipTotal = wip.reduce((s, w) => s + w.count, 0);
  const wipSummary = `Открытых задач в работе на доске: ${wipTotal}`;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">
          Пропускная способность (задач/неделю)
        </h3>
        <div className="h-56 w-full" role="img" aria-label={tpSummary}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={tp} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
              <CartesianGrid stroke={tokens.colors.border} strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: tokens.colors.mutedForeground }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: tokens.colors.mutedForeground }} />
              <Tooltip
                cursor={{ fill: tokens.colors.muted }}
                contentStyle={{
                  background: tokens.colors.background,
                  border: `1px solid ${tokens.colors.border}`,
                  borderRadius: tokens.radius.md,
                  fontSize: 12,
                  fontVariantNumeric: 'tabular-nums',
                }}
                formatter={(value: number) => [`${value}`, 'Задач']}
                isAnimationActive={false}
              />
              <Bar dataKey="count" fill={tokens.colors.foreground} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <table className="sr-only">
          <caption>{tpSummary}</caption>
          <thead>
            <tr>
              <th scope="col">Неделя</th>
              <th scope="col">Задач</th>
            </tr>
          </thead>
          <tbody>
            {tp.map((p) => (
              <tr key={p.week}>
                <th scope="row">{p.label}</th>
                <td>{p.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">
          Текущий WIP по колонкам
        </h3>
        <div className="h-56 w-full" role="img" aria-label={wipSummary}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={wip} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
              <CartesianGrid stroke={tokens.colors.border} strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: tokens.colors.mutedForeground }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: tokens.colors.mutedForeground }} />
              <Tooltip
                cursor={{ fill: tokens.colors.muted }}
                contentStyle={{
                  background: tokens.colors.background,
                  border: `1px solid ${tokens.colors.border}`,
                  borderRadius: tokens.radius.md,
                  fontSize: 12,
                  fontVariantNumeric: 'tabular-nums',
                }}
                formatter={(value: number) => [`${value}`, 'Задач']}
                isAnimationActive={false}
              />
              <Bar dataKey="count" fill={tokens.colors.foreground} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <table className="sr-only">
          <caption>{wipSummary}</caption>
          <thead>
            <tr>
              <th scope="col">Колонка</th>
              <th scope="col">Задач</th>
            </tr>
          </thead>
          <tbody>
            {wip.map((w) => (
              <tr key={w.status}>
                <th scope="row">{w.label}</th>
                <td>{w.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
