import type { PipelineSummary as Summary } from '@/lib/crm';

function fmt(v: number): string {
  try {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v);
  } catch {
    return String(v);
  }
}

/** 3-stat summary strip for a pipeline (presentational). */
export function PipelineSummary({ summary }: { summary: Summary }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Stat label="Открытые сделки" value={`${summary.openCount}`} sub={fmt(summary.openValue)} />
      <Stat label="Выиграно" value={`${summary.wonCount}`} sub={fmt(summary.wonValue)} accent="emerald" />
      <Stat label="Проиграно" value={`${summary.lostCount}`} />
      <Stat label="Win rate" value={`${summary.winRate}%`} />
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: 'emerald' }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <div className={`text-lg font-semibold tabular-nums ${accent === 'emerald' ? 'text-emerald-600' : ''}`}>
        {value}
      </div>
      {sub ? <div className="text-xs text-muted-foreground tabular-nums">{sub}</div> : null}
      <div className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
