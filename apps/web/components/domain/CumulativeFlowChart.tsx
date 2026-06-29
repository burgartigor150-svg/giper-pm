import type { CumulativeFlow } from '@/lib/board/getCumulativeFlow';

/**
 * Cumulative-flow diagram: stacked areas of card count per status over time.
 * The widening/narrowing bands reveal WIP growth and bottlenecks. Built from
 * daily snapshots, so it needs ≥2 of them before it can draw.
 */
export function CumulativeFlowChart({ data }: { data: CumulativeFlow }) {
  const n = data.dates.length;

  if (n < 2) {
    return (
      <p className="text-sm text-muted-foreground">
        Диаграмма появится, когда накопятся хотя бы два суточных снимка (их пишет
        ежедневный cron).
      </p>
    );
  }

  const W = 720;
  const H = 260;
  const padL = 28;
  const padR = 8;
  const padT = 8;
  const padB = 20;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  // Max stacked total across days → y scale.
  const totals = data.dates.map((_, i) =>
    data.series.reduce((sum, s) => sum + (s.counts[i] ?? 0), 0),
  );
  const maxY = Math.max(1, ...totals);

  const x = (i: number) => padL + (i / (n - 1)) * plotW;
  const y = (v: number) => padT + plotH - (Math.max(0, Math.min(maxY, v)) / maxY) * plotH;

  // Stack bottom→top: series[0] (DONE) sits at the bottom.
  const cum = data.dates.map(() => 0);
  const bands = data.series.map((s) => {
    const lower = data.dates.map((_, i) => cum[i]!);
    data.dates.forEach((_, i) => {
      cum[i] = cum[i]! + (s.counts[i] ?? 0);
    });
    const upper = data.dates.map((_, i) => cum[i]!);
    // Polygon: upper edge left→right, then lower edge right→left.
    const top = upper.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const bottom = lower
      .map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`)
      .reverse();
    return { status: s.status, label: s.label, color: s.color, points: [...top, ...bottom].join(' ') };
  });

  const yTicks = niceTicks(maxY, 4);
  const fmtDay = (d: string) => d.slice(5); // MM-DD

  return (
    <div className="flex flex-col gap-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Кумулятивная диаграмма потока"
      >
        {/* Y grid + labels */}
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={padL} y1={y(t)} x2={W - padR} y2={y(t)} stroke="currentColor" className="text-border" strokeWidth={0.5} />
            <text x={padL - 4} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground text-[9px]">
              {t}
            </text>
          </g>
        ))}
        {/* Stacked bands */}
        {bands.map((b) => (
          <polygon key={b.status} points={b.points} fill={b.color} fillOpacity={0.85} />
        ))}
        {/* X labels: first, middle, last (deduped so n=2 doesn't double the first) */}
        {[...new Set([0, Math.floor((n - 1) / 2), n - 1])].map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[9px]">
            {fmtDay(data.dates[i]!)}
          </text>
        ))}
      </svg>

      {/* Legend (top band first to read top→bottom). */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {[...bands].reverse().map((b) => (
          <span key={b.status} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: b.color }} aria-hidden />
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Round, evenly-spaced y-axis ticks from 0 to ~max. */
function niceTicks(max: number, count: number): number[] {
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const step = Math.max(1, Math.ceil(raw / mag) * mag);
  const ticks: number[] = [];
  for (let t = 0; t <= max + step / 2; t += step) ticks.push(Math.round(t));
  return ticks;
}
