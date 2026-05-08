import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import type { ProjectBudgetReport } from '@/lib/reports/projectBudget';

type Props = {
  report: ProjectBudgetReport;
};

/**
 * Compact panel: budget vs spent bar, projected finish date, and the
 * currency line if hourlyRate is set on the project. Designed for the
 * /projects/[key] overview page right above the kanban link.
 */
export function ProjectBudgetCard({ report }: Props) {
  const r = report;
  const pct =
    r.budgetHours && r.budgetHours > 0
      ? Math.min(100, Math.round((r.spentHours / r.budgetHours) * 100))
      : null;
  const remainingHours = r.budgetHours
    ? Math.max(0, r.budgetHours - r.spentHours)
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Бюджет и прогноз</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {r.budgetHours != null ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                Потрачено: {r.spentHours} ч из {r.budgetHours} ч
                {pct != null ? ` · ${pct}%` : ''}
              </span>
              {r.overBudget ? (
                <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-red-800">
                  превышен
                </span>
              ) : remainingHours != null ? (
                <span className="text-xs text-muted-foreground">
                  осталось {remainingHours.toFixed(1)} ч
                </span>
              ) : null}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={[
                  'h-full transition-all',
                  r.overBudget ? 'bg-red-500' : pct! > 80 ? 'bg-amber-500' : 'bg-emerald-500',
                ].join(' ')}
                style={{ width: `${Math.min(100, pct ?? 0)}%` }}
              />
            </div>
          </div>
        ) : (
          <p className="text-xs italic text-muted-foreground">
            Бюджет не задан — выставьте «Часы по бюджету» в настройках проекта,
            чтобы видеть прогноз.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 text-xs">
          <Stat label="Оценка по задачам" value={`${r.estimatedHours} ч`} />
          <Stat
            label="Скорость (14 дн)"
            value={`${r.velocityHoursPerDay} ч/день`}
          />
          <Stat
            label="Осталось работы"
            value={`${r.remainingEstimatedHours} ч`}
          />
          <Stat
            label="Прогноз окончания"
            value={
              r.projectedFinishDate
                ? `~ ${new Date(r.projectedFinishDate).toLocaleDateString('ru-RU')}`
                : '—'
            }
            hint={
              r.projectedDaysToFinish != null
                ? `≈ ${r.projectedDaysToFinish} дн`
                : 'Нет логов времени за 14 дней'
            }
          />
        </div>

        {r.hourlyRate != null && r.budgetMoney != null ? (
          <div className="flex items-center justify-between border-t border-border pt-2 text-xs">
            <span className="text-muted-foreground">
              Стоимость: {r.spentMoney?.toLocaleString('ru-RU')} ₽ из{' '}
              {r.budgetMoney.toLocaleString('ru-RU')} ₽
            </span>
            <span className="text-muted-foreground">
              ставка {r.hourlyRate.toLocaleString('ru-RU')} ₽/ч
            </span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm font-medium">{value}</div>
      {hint ? <div className="text-[10px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
