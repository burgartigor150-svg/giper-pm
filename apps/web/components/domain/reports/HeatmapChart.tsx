type Props = {
  /** 7×24 matrix of total minutes. Row 0 = Monday, col 0 = 00:00. */
  grid: number[][];
  /** Max value across the grid — used to scale cell colour intensity. */
  max: number;
};

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/**
 * Day-of-week × hour-of-day intensity grid. Pure server component —
 * just CSS-coloured divs, no recharts dependency.
 *
 * Color scale: linear blue from background to deep blue based on
 * cell-value/max. We don't quantize because for "spot the night work"
 * any non-zero cell already pops against the empty grid.
 */
export function HeatmapChart({ grid, max }: Props) {
  if (max === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Нет активности за период.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-[10px] tabular-nums">
        <thead>
          <tr>
            <th className="w-7" />
            {Array.from({ length: 24 }, (_, h) => (
              <th key={h} className="px-0.5 text-center text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAYS.map((day, di) => (
            <tr key={day}>
              <td className="pr-2 text-right text-muted-foreground">{day}</td>
              {Array.from({ length: 24 }, (_, hi) => {
                const v = grid[di]?.[hi] ?? 0;
                const intensity = max > 0 ? v / max : 0;
                const bg =
                  v === 0
                    ? 'rgb(244, 244, 245)' // muted/30
                    : `rgba(59, 130, 246, ${0.15 + intensity * 0.85})`;
                return (
                  <td
                    key={hi}
                    className="h-5 w-5 rounded-sm border border-background"
                    style={{ background: bg }}
                    title={`${day} ${String(hi).padStart(2, '0')}:00 — ${formatMin(v)}`}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span>0</span>
        <div className="h-2 w-32 rounded-sm bg-gradient-to-r from-[rgba(59,130,246,0.15)] to-[rgba(59,130,246,1)]" />
        <span>{formatMin(max)}</span>
      </div>
    </div>
  );
}

function formatMin(min: number): string {
  if (min === 0) return '0';
  if (min < 60) return `${min}м`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}ч ${m}м` : `${h}ч`;
}
