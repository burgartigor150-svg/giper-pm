import { formatMinutes } from '@/lib/format/duration';

type Props = {
  /** Estimated hours, as Decimal-string from Prisma. null = no estimate set. */
  estimateHours: string | null;
  /** Actual minutes spent across all entries (includes live timer). */
  spentMinutes: number;
};

/**
 * Visual estimate-vs-actual indicator on the task sidebar. Three states:
 *
 *   1. No estimate     → just shows the spent total ("Потрачено: 2ч 30м").
 *   2. Under estimate  → green progress bar with "1ч 30м / 4ч (38%)".
 *   3. Over estimate   → red bar that goes past 100%, e.g. "5ч / 4ч (+25%)".
 *
 * The 80% threshold flips the bar to amber as a soft warning that the
 * estimate is about to be exceeded.
 *
 * Server component — no hooks, no client JS. Re-renders happen on the
 * task page revalidate cycle, which is fine: this isn't a live ticker.
 */
export function EstimateVsActual({ estimateHours, spentMinutes }: Props) {
  if (!estimateHours) {
    return (
      <div className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">Потрачено</span>
        <span className="font-medium">{formatMinutes(spentMinutes)}</span>
      </div>
    );
  }

  const estimateMin = Math.round(Number(estimateHours) * 60);
  if (estimateMin <= 0) {
    return (
      <div className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">Потрачено</span>
        <span className="font-medium">{formatMinutes(spentMinutes)}</span>
      </div>
    );
  }
  const ratio = spentMinutes / estimateMin;
  const overrun = ratio > 1;
  const warning = ratio >= 0.8 && ratio <= 1;
  const fillPct = Math.min(100, Math.round(ratio * 100));
  const barColor = overrun
    ? 'bg-red-500'
    : warning
      ? 'bg-amber-500'
      : 'bg-emerald-500';
  const labelColor = overrun
    ? 'text-red-600'
    : warning
      ? 'text-amber-600'
      : 'text-muted-foreground';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">
          {formatMinutes(spentMinutes)}{' '}
          <span className="text-xs text-muted-foreground">/ {formatMinutes(estimateMin)}</span>
        </span>
        <span className={`text-xs ${labelColor}`}>
          {overrun
            ? `+${Math.round((ratio - 1) * 100)}%`
            : `${Math.round(ratio * 100)}%`}
        </span>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full transition-all ${barColor}`}
          style={{ width: `${fillPct}%` }}
        />
        {overrun ? (
          // Diagonal stripes on the overrun portion to underline that we're
          // past the line; CSS-only, no DOM cost beyond an extra ::after.
          <div
            className="absolute inset-0 bg-[repeating-linear-gradient(45deg,transparent_0_4px,rgba(255,255,255,0.4)_4px_8px)]"
            aria-hidden
          />
        ) : null}
      </div>
    </div>
  );
}
