import Link from 'next/link';
import { Pencil } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { timeListFilterSchema } from '@giper/shared';
import { requireAuth } from '@/lib/auth';
import { listTimeEntries, resolveRange } from '@/lib/time';
import { getT } from '@/lib/i18n';
import { AddManualToggle } from '@/components/domain/AddManualToggle';
import { TimeRangeTabs } from '@/components/domain/TimeRangeTabs';
import { TimeProjectPie, colorForIndex } from '@/components/domain/TimeProjectPie';
import { DeleteTimeEntryButton } from '@/components/domain/DeleteTimeEntryButton';
import {
  TimeSelectionProvider,
  HeaderCheckbox,
  RowCheckbox,
  BulkActionBar,
} from '@/components/domain/TimeBulkActions';

export default async function TimePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const me = await requireAuth();
  const t = await getT('time');
  const tTable = await getT('time.table');
  const tSource = await getT('time.source');
  const tFlag = await getT('time.flag');

  const filterRaw: Record<string, string> = {};
  for (const k of ['range', 'from', 'to']) {
    const v = sp[k];
    if (typeof v === 'string') filterRaw[k] = v;
  }
  const parsed = timeListFilterSchema.safeParse(filterRaw);
  const filter = parsed.success ? parsed.data : timeListFilterSchema.parse({});

  const range = resolveRange(filter.range, filter.from, filter.to);
  const entries = await listTimeEntries(me.id, range);

  // Compute totals.
  const totalMin = entries.reduce((s, e) => s + (e.durationMin ?? 0), 0);
  const totalHours = (totalMin / 60).toFixed(1);

  // Per-project aggregation (entries without task or with deleted task -> "Без проекта").
  type ProjectAgg = { key: string; name: string; minutes: number };
  const projAgg = new Map<string, ProjectAgg>();
  for (const e of entries) {
    const projKey = e.task?.project.key ?? '__none';
    const projName = e.task?.project.name ?? 'Без проекта';
    const mins = e.durationMin ?? 0;
    const cur = projAgg.get(projKey) ?? { key: projKey, name: projName, minutes: 0 };
    cur.minutes += mins;
    projAgg.set(projKey, cur);
  }
  const slices = Array.from(projAgg.values())
    .sort((a, b) => b.minutes - a.minutes)
    .map((p, i) => ({ label: p.name, minutes: p.minutes, color: colorForIndex(i) }));

  // Only closed entries are eligible for bulk-reassign — moving a live
  // timer would need a stop+start. UI keeps it simple by hiding the
  // checkbox on open rows.
  const selectableIds = entries.filter((e) => e.endedAt != null).map((e) => e.id);

  return (
    <TimeSelectionProvider>
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <AddManualToggle />
      </div>

      <Card className="p-4">
        <TimeRangeTabs range={filter.range} from={filter.from} to={filter.to} />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="overflow-hidden min-w-0">
          {entries.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">{t('noEntries')}</div>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 w-8">
                    <HeaderCheckbox entryIds={selectableIds} />
                  </th>
                  <th className="px-3 py-2 font-medium">{tTable('when')}</th>
                  <th className="px-3 py-2 font-medium">{tTable('task')}</th>
                  <th className="px-3 py-2 font-medium">{tTable('duration')}</th>
                  <th className="px-3 py-2 font-medium">{tTable('note')}</th>
                  <th className="px-3 py-2 font-medium">{tTable('source')}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-t border-border align-top">
                    <td className="px-3 py-2">
                      {e.endedAt ? <RowCheckbox entryId={e.id} /> : null}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
                      <div>{new Date(e.startedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</div>
                      {e.endedAt ? (
                        <div>→ {new Date(e.endedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div>
                      ) : (
                        <div className="text-amber-700">{t('timer.running')}</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {e.task ? (
                        <Link
                          href={`/projects/${e.task.project.key}/tasks/${e.task.number}`}
                          className="hover:underline"
                        >
                          <span className="font-mono text-xs text-muted-foreground">
                            {e.task.project.key}-{e.task.number}
                          </span>{' '}
                          {e.task.title}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {e.durationMin ? `${(e.durationMin / 60).toFixed(2)} ч` : '—'}
                      {e.flag ? (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700">
                          {tFlag(e.flag)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 max-w-[280px] truncate text-muted-foreground" title={e.note ?? ''}>
                      {e.note ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {tSource(e.source)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {e.endedAt ? (
                          <Link href={`/time/${e.id}/edit`}>
                            <button
                              type="button"
                              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                              aria-label="Редактировать"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          </Link>
                        ) : null}
                        <DeleteTimeEntryButton entryId={e.id} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('totalHours')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="text-3xl font-semibold tracking-tight">{totalHours}</div>
            {slices.length > 0 ? (
              <>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('perProject')}
                </div>
                <TimeProjectPie slices={slices} />
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
      <BulkActionBar />
    </div>
    </TimeSelectionProvider>
  );
}
