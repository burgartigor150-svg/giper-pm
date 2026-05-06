'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { tokens } from '@giper/ui';

type Point = { dayKey: string; label: string; minutes: number };

export function Last7DaysChart({ data }: { data: Point[] }) {
  const chartData = data.map((d) => ({ ...d, hours: +(d.minutes / 60).toFixed(2) }));
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
          <CartesianGrid stroke={tokens.colors.border} strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: tokens.colors.mutedForeground }} />
          <YAxis tick={{ fontSize: 11, fill: tokens.colors.mutedForeground }} />
          <Tooltip
            cursor={{ fill: tokens.colors.muted }}
            contentStyle={{
              background: tokens.colors.background,
              border: `1px solid ${tokens.colors.border}`,
              borderRadius: tokens.radius.md,
              fontSize: 12,
            }}
            formatter={(value: number) => [`${value} ч`, 'Часы']}
            labelFormatter={(l) => l}
          />
          <Bar dataKey="hours" fill={tokens.colors.primary} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
