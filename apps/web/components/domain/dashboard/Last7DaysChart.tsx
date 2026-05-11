'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { tokens } from '@giper/ui';

type Point = { dayKey: string; label: string; minutes: number };

/**
 * Bar chart of the last 7 days of tracked time. Per MASTER.md §10:
 *  - The chart container has role="img" + a summary aria-label so SR
 *    users get an accessible overview instead of a silent canvas.
 *  - A sr-only <table> below mirrors the same data — keyboard and SR
 *    users can read exact numbers.
 *  - Bar colour is foreground (neutral), NOT the accent. Amber accent
 *    stays reserved for CTAs (MASTER §1).
 *  - Tooltip values use tabular-nums via formatter wrapping.
 */
export function Last7DaysChart({ data }: { data: Point[] }) {
  const chartData = data.map((d) => ({ ...d, hours: +(d.minutes / 60).toFixed(2) }));
  const total = chartData.reduce((sum, d) => sum + d.hours, 0);
  const peak = chartData.reduce(
    (best, d) => (d.hours > best.hours ? d : best),
    chartData[0] ?? { label: '—', hours: 0 },
  );
  const summary = `За 7 дней: ${total.toFixed(1)} ч, пик ${peak.label} (${peak.hours.toFixed(1)} ч)`;
  return (
    <>
      <div className="h-56 w-full" role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
            <CartesianGrid stroke={tokens.colors.border} strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: tokens.colors.mutedForeground }} />
            <YAxis tick={{ fontSize: 12, fill: tokens.colors.mutedForeground }} />
            <Tooltip
              cursor={{ fill: tokens.colors.muted }}
              contentStyle={{
                background: tokens.colors.background,
                border: `1px solid ${tokens.colors.border}`,
                borderRadius: tokens.radius.md,
                fontSize: 12,
                fontVariantNumeric: 'tabular-nums',
              }}
              formatter={(value: number) => [`${value.toFixed(1)} ч`, 'Часы']}
              labelFormatter={(l) => l}
              isAnimationActive={false}
            />
            <Bar
              dataKey="hours"
              fill={tokens.colors.foreground}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* Accessible data table mirror. Recharts itself is canvas-like
          for assistive tech; this gives SR + keyboard users the same
          information. */}
      <table className="sr-only">
        <caption>{summary}</caption>
        <thead>
          <tr>
            <th scope="col">День</th>
            <th scope="col">Часы</th>
          </tr>
        </thead>
        <tbody>
          {chartData.map((d) => (
            <tr key={d.dayKey}>
              <th scope="row">{d.label}</th>
              <td>{d.hours.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
