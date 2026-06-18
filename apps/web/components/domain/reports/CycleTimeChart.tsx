'use client';

import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';

type Point = { seq: number; date: string; hours: number; number: number };

type Stats = {
  points: Point[];
  count: number;
  p50: number | null;
  p75: number | null;
  p95: number | null;
  mean: number;
  ucl: number;
};

/**
 * Cycle-time control chart: each completed task is one dot (sequence vs hours
 * from start to done). The mean and upper control limit (mean + 2σ) are drawn
 * as reference lines so outliers above the UCL stand out. The p50/p75/p95
 * percentile summary sits above the chart as the at-a-glance distribution.
 */
export function CycleTimeChart({ stats }: { stats: Stats }) {
  if (stats.count === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Нет завершённых задач со временем начала за выбранный период.
      </p>
    );
  }

  const fmt = (h: number | null) => (h == null ? '—' : h >= 48 ? `${(h / 24).toFixed(1)} дн` : `${h} ч`);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Медиана (p50)" value={fmt(stats.p50)} />
        <Metric label="p75" value={fmt(stats.p75)} />
        <Metric label="p95" value={fmt(stats.p95)} />
        <Metric label="Задач" value={stats.count.toString()} />
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis
              type="number"
              dataKey="seq"
              name="№"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              domain={[0, 'dataMax + 1']}
              allowDecimals={false}
            />
            <YAxis
              type="number"
              dataKey="hours"
              name="Часы"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={36}
            />
            <ZAxis range={[40, 40]} />
            <ReferenceLine
              y={stats.mean}
              stroke="#6366f1"
              strokeDasharray="4 4"
              label={{ value: `среднее ${fmt(stats.mean)}`, fontSize: 10, fill: '#6366f1', position: 'insideTopLeft' }}
            />
            <ReferenceLine
              y={stats.ucl}
              stroke="#ef4444"
              strokeDasharray="4 4"
              label={{ value: `UCL ${fmt(stats.ucl)}`, fontSize: 10, fill: '#ef4444', position: 'insideTopLeft' }}
            />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              formatter={(v: number | string, name: string) =>
                name === 'Часы' ? [fmt(Number(v)), 'Цикл'] : [v, name]
              }
              labelFormatter={() => ''}
              content={({ payload }) => {
                const p = payload?.[0]?.payload as Point | undefined;
                if (!p) return null;
                return (
                  <div className="rounded border bg-background px-2 py-1 text-xs shadow">
                    <div className="font-medium">#{p.number}</div>
                    <div>Цикл: {fmt(p.hours)}</div>
                    <div className="text-muted-foreground">{p.date}</div>
                  </div>
                );
              }}
            />
            <Scatter data={stats.points} fill="#3b82f6" fillOpacity={0.7} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
