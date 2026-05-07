'use client';

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type Point = { date: string; estimated: number; done: number };

/**
 * Cumulative estimated hours (created tasks) vs done hours (closed tasks)
 * over the selected period. Gap between the two = remaining work.
 *
 * Both series are step lines so the rectangles read as "X hours of work
 * appeared on day Y" rather than implying a smooth burn-rate.
 */
export function BurndownChart({ data }: { data: Point[] }) {
  if (data.length === 0 || (data.at(-1)!.estimated === 0 && data.at(-1)!.done === 0)) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Нет задач с оценкой за период.
      </p>
    );
  }
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => d.slice(5)}
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <YAxis fontSize={11} tickLine={false} axisLine={false} width={32} />
          <Tooltip formatter={(v: number, n) => [`${v} ч`, n === 'estimated' ? 'Оценено' : 'Сделано']} />
          <Legend
            verticalAlign="top"
            height={24}
            formatter={(v) => (v === 'estimated' ? 'Оценено' : 'Сделано')}
            iconType="line"
          />
          <Area
            type="step"
            dataKey="estimated"
            stroke="#9ca3af"
            fill="#e5e7eb"
            strokeWidth={1.5}
          />
          <Line
            type="step"
            dataKey="done"
            stroke="#10b981"
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
