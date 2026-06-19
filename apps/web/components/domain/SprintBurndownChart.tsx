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
        а не по Bitrix-статусу. Это срез на сейчас — историческую линию по дням
        пока не строим (нет посуточных снимков; перетаскивание на доске их не
        пишет). Полноценный исторический burndown — отдельная доработка.
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
