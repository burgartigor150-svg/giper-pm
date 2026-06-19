'use client';

import type { SprintBurndown } from '@/lib/sprints/getSprintBurndown';

/**
 * Sprint progress ("burndown"). HONEST about its limitation: the team has no
 * per-day completion history (board drags log neither completedAt nor a
 * status-change row), so this is a CURRENT-STATE projection — committed vs
 * remaining off the internal board status — not a reconstructed historical
 * burn line. The ideal-pace marker shows where remaining "should" be today if
 * burning down linearly over the sprint dates.
 */
export function SprintBurndownChart({ data }: { data: SprintBurndown }) {
  const unit = data.usePoints ? 'SP' : 'зад.';
  const burned = data.committed - data.remaining;
  const pct = data.committed > 0 ? Math.round((burned / data.committed) * 100) : 0;

  // Ideal-pace remaining for "today", if the sprint has both dates.
  let idealRemaining: number | null = null;
  if (data.startDate && data.endDate) {
    const start = new Date(`${data.startDate}T00:00:00Z`).getTime();
    const end = new Date(`${data.endDate}T00:00:00Z`).getTime();
    const now = Date.now();
    if (end > start) {
      const frac = Math.min(1, Math.max(0, (now - start) / (end - start)));
      idealRemaining = Math.round(data.committed * (1 - frac) * 10) / 10;
    }
  }
  const behind = idealRemaining != null && data.remaining > idealRemaining;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Взято" value={`${data.committed} ${unit}`} />
        <Metric label="Осталось" value={`${data.remaining} ${unit}`} accent={behind ? 'amber' : 'emerald'} />
        <Metric label="Сделано" value={`${pct}%`} />
        <Metric label="Карточек" value={`${data.doneCount}/${data.totalCount}`} />
      </div>

      {/* Progress bar: burned vs committed. */}
      <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>

      {/* Real historical burn line from daily snapshots, once ≥2 exist. */}
      {data.history.length >= 2
        ? (() => {
            const W = 300;
            const H = 80;
            const maxY = Math.max(
              1,
              data.committed,
              ...data.history.map((h) => h.remaining),
            );
            const n = data.history.length;
            const x = (i: number) => (i / (n - 1)) * W;
            const y = (v: number) =>
              H - (Math.max(0, Math.min(maxY, v)) / maxY) * H;
            const line = data.history
              .map(
                (h, i) =>
                  `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(h.remaining).toFixed(1)}`,
              )
              .join(' ');
            const startRemaining = data.history[0]!.remaining;
            return (
              <div>
                <svg
                  viewBox={`0 0 ${W} ${H}`}
                  className="h-24 w-full rounded-md border bg-muted/20"
                  preserveAspectRatio="none"
                  aria-label="Burndown по дням"
                >
                  <line
                    x1={0}
                    y1={y(startRemaining)}
                    x2={W}
                    y2={y(0)}
                    className="stroke-muted-foreground/40"
                    strokeWidth={1}
                    strokeDasharray="4 3"
                    vectorEffect="non-scaling-stroke"
                  />
                  <path
                    d={line}
                    fill="none"
                    className="stroke-emerald-500"
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>{data.history[0]!.date}</span>
                  <span>{data.history[n - 1]!.date}</span>
                </div>
              </div>
            );
          })()
        : null}

      {idealRemaining != null ? (
        <p className="text-xs text-muted-foreground">
          Идеальный темп на сегодня: осталось бы ≈ {idealRemaining} {unit}.{' '}
          {behind ? (
            <span className="text-amber-600">Отстаём от графика.</span>
          ) : (
            <span className="text-emerald-600">В графике.</span>
          )}
        </p>
      ) : null}

      <p className="text-[11px] text-muted-foreground">
        Прогресс считается по внутреннему статусу доски (DONE/CANCELED = сожжено),
        а не по Bitrix-статусу.{' '}
        {data.history.length >= 2
          ? 'Линия — фактический остаток по дням (посуточные снимки), пунктир — идеальный темп.'
          : 'Историческая линия появится, когда накопятся посуточные снимки (пишутся ежедневным cron).'}
      </p>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: 'amber' | 'emerald' }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <div
        className={`text-lg font-semibold tabular-nums ${
          accent === 'amber' ? 'text-amber-600' : accent === 'emerald' ? 'text-emerald-600' : ''
        }`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
