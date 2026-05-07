'use client';

import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

type Slice = { type: string; minutes: number; pct: number };

const COLORS: Record<string, string> = {
  TASK: '#64748b',
  BUG: '#ef4444',
  FEATURE: '#3b82f6',
  EPIC: '#8b5cf6',
  CHORE: '#a3a3a3',
};

const LABELS: Record<string, string> = {
  TASK: 'Задача',
  BUG: 'Баг',
  FEATURE: 'Фича',
  EPIC: 'Эпик',
  CHORE: 'Рутина',
};

/**
 * Pie of where time went by task type. Empty types are filtered server-
 * side so the legend doesn't carry dead entries. Tooltip shows hours +
 * percent — recharts default just shows raw value, useless for time data.
 */
export function TypeDistributionChart({ slices }: { slices: Slice[] }) {
  if (slices.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Нет данных для распределения.
      </p>
    );
  }
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={slices}
            dataKey="minutes"
            nameKey="type"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={2}
          >
            {slices.map((s) => (
              <Cell key={s.type} fill={COLORS[s.type] ?? '#94a3b8'} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v: number, _name, props) => {
              const pct = (props as { payload?: Slice }).payload?.pct ?? 0;
              const hours = +(v / 60).toFixed(1);
              return [`${hours} ч (${pct}%)`, LABELS[String(props.payload?.type)] ?? String(props.payload?.type)];
            }}
          />
          <Legend
            verticalAlign="bottom"
            iconType="circle"
            formatter={(v) => LABELS[String(v)] ?? String(v)}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
