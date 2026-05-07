'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type Point = { date: string; hours: number };

/**
 * Velocity / activity trend. Single area line of hours-per-bucket.
 * Buckets are decided server-side (day or week) so the chart is the
 * same component for both views.
 */
export function VelocityChart({ data }: { data: Point[] }) {
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Нет данных за выбранный период.
      </p>
    );
  }
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="velocityFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => d.slice(5)}
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <YAxis fontSize={11} tickLine={false} axisLine={false} width={32} />
          <Tooltip
            formatter={(v) => [`${v} ч`, 'Часов']}
            labelFormatter={(d) => `Дата: ${d}`}
          />
          <Area
            type="monotone"
            dataKey="hours"
            stroke="#3b82f6"
            strokeWidth={2}
            fill="url(#velocityFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
