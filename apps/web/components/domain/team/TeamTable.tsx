'use client';

import { useMemo, useState } from 'react';
import { Avatar } from '@giper/ui/components/Avatar';
import { cn } from '@giper/ui/cn';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useT } from '@/lib/useT';
import { LiveDuration } from '@/components/domain/LiveDuration';
import { minutesToHours } from '@/lib/format/duration';

type Status = 'ACTIVE' | 'ONLINE' | 'OFFLINE' | 'NO_DEVICE';

type Row = {
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
    role: string;
  };
  currentTask: {
    id: string;
    number: number;
    title: string;
    project: { key: string };
  } | null;
  timerStartedAt: string | null;
  todayMin: number;
  status: Status;
};

type SortField = 'name' | 'task' | 'timerStartedAt' | 'todayMin' | 'status';

const STATUS_BG: Record<Status, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  ONLINE: 'bg-sky-100 text-sky-700',
  OFFLINE: 'bg-neutral-200 text-neutral-700',
  NO_DEVICE: 'bg-neutral-100 text-neutral-500',
};

export function TeamTable({ rows }: { rows: Row[] }) {
  const t = useT('team');
  const tStatus = useT('team.status');
  const [sort, setSort] = useState<SortField>('status');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const r = compare(a, b, sort);
      return dir === 'asc' ? r : -r;
    });
    return copy;
  }, [rows, sort, dir]);

  function toggle(f: SortField) {
    if (sort === f) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(f);
      setDir('asc');
    }
  }

  if (rows.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">{t('empty')}</div>;
  }

  return (
    <table className="w-full text-sm">
      <thead className="bg-muted/50 text-left">
        <tr>
          <SortTh label={t('table.user')} field="name" sort={sort} dir={dir} toggle={toggle} />
          <SortTh label={t('table.task')} field="task" sort={sort} dir={dir} toggle={toggle} />
          <SortTh label={t('table.timer')} field="timerStartedAt" sort={sort} dir={dir} toggle={toggle} />
          <SortTh label={t('table.today')} field="todayMin" sort={sort} dir={dir} toggle={toggle} />
          <SortTh label={t('table.status')} field="status" sort={sort} dir={dir} toggle={toggle} />
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.user.id} className="border-t border-border align-top">
            <td className="px-4 py-2">
              <div className="flex items-center gap-2">
                <Avatar src={r.user.image} alt={r.user.name} className="h-7 w-7" />
                <div className="flex flex-col">
                  <span>{r.user.name}</span>
                  <span className="text-xs text-muted-foreground">{r.user.email}</span>
                </div>
              </div>
            </td>
            <td className="px-4 py-2">
              {r.currentTask ? (
                <a
                  href={`/projects/${r.currentTask.project.key}/tasks/${r.currentTask.number}`}
                  className="hover:underline"
                >
                  <span className="font-mono text-xs text-muted-foreground">
                    {r.currentTask.project.key}-{r.currentTask.number}
                  </span>{' '}
                  {r.currentTask.title}
                </a>
              ) : (
                <span className="text-muted-foreground">{t('noTask')}</span>
              )}
            </td>
            <td className="px-4 py-2 whitespace-nowrap font-mono text-xs">
              {r.timerStartedAt ? <LiveDuration startedAt={r.timerStartedAt} /> : t('noTimer')}
            </td>
            <td className="px-4 py-2 whitespace-nowrap">{minutesToHours(r.todayMin)} ч</td>
            <td className="px-4 py-2">
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                  STATUS_BG[r.status],
                )}
              >
                {tStatus(r.status)}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function compare(a: Row, b: Row, field: SortField): number {
  switch (field) {
    case 'name':
      return a.user.name.localeCompare(b.user.name, 'ru');
    case 'task': {
      const at = a.currentTask?.title ?? '';
      const bt = b.currentTask?.title ?? '';
      return at.localeCompare(bt, 'ru');
    }
    case 'timerStartedAt': {
      const an = a.timerStartedAt ? new Date(a.timerStartedAt).getTime() : 0;
      const bn = b.timerStartedAt ? new Date(b.timerStartedAt).getTime() : 0;
      return an - bn;
    }
    case 'todayMin':
      return a.todayMin - b.todayMin;
    case 'status': {
      const order: Record<Status, number> = { ACTIVE: 0, ONLINE: 1, OFFLINE: 2, NO_DEVICE: 3 };
      return order[a.status] - order[b.status];
    }
  }
}

function SortTh({
  label,
  field,
  sort,
  dir,
  toggle,
}: {
  label: string;
  field: SortField;
  sort: SortField;
  dir: 'asc' | 'desc';
  toggle: (f: SortField) => void;
}) {
  const active = sort === field;
  const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      <button
        type="button"
        onClick={() => toggle(field)}
        className={cn(
          'inline-flex items-center gap-1 transition-colors',
          active ? 'text-foreground' : '',
        )}
      >
        {label}
        <Icon className="h-3 w-3" />
      </button>
    </th>
  );
}
