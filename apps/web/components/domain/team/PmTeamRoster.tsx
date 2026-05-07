'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, UserMinus, Users } from 'lucide-react';
import { Avatar } from '@giper/ui/components/Avatar';
import type { Position } from '@giper/db';
import { addToPmTeamAction, removeFromPmTeamAction } from '@/actions/pmTeam';
import type { TeamMemberRow } from '@/lib/teams/types';

type Props = {
  members: TeamMemberRow[];
  /** PMs the current user can identify by id when surfacing "also on PM X's team". */
  pmsById: Record<string, string>;
};

const POSITION_LABELS: Record<Position, string> = {
  FRONTEND: 'Frontend',
  BACKEND: 'Backend',
  FULLSTACK: 'Fullstack',
  MOBILE: 'Mobile',
  QA: 'QA',
  QA_AUTO: 'QA Auto',
  DESIGNER: 'Designer',
  UX: 'UX',
  ANALYST: 'Analyst',
  BA: 'Business Analyst',
  PM: 'PM',
  LEAD: 'Lead',
  DEVOPS: 'DevOps',
  SRE: 'SRE',
  CONTENT: 'Content',
  MARKETING: 'Marketing',
  OTHER: 'Other',
};

const ALL_POSITIONS = Object.keys(POSITION_LABELS) as Position[];

/**
 * PM "my team" management. Displays every active user in the system
 * with current load (active task count) and lets the PM toggle them
 * in/out of their personal roster. People sit in multiple PMs'
 * rosters in parallel — that's surfaced via "Также у:" text so the
 * PM picking a free resource sees the full picture.
 *
 * Filters: by position (specialty), by load (free / partly busy /
 * busy), by my-team-only.
 *
 * Load colour coding:
 *   0 active           → green   "free"
 *   1-2 active         → amber   "lightly loaded"
 *   3+ active          → red     "heavy"
 */
export function PmTeamRoster({ members, pmsById }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filterPosition, setFilterPosition] = useState<'' | Position>('');
  const [filterLoad, setFilterLoad] = useState<'' | 'free' | 'busy'>('');
  const [onlyMine, setOnlyMine] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    return members.filter((m) => {
      if (onlyMine && !m.inMyTeam) return false;
      if (filterPosition && !m.positions.includes(filterPosition)) return false;
      if (filterLoad === 'free' && (m.activeTaskCount + m.activeAssignmentCount) > 0)
        return false;
      if (filterLoad === 'busy' && (m.activeTaskCount + m.activeAssignmentCount) < 1)
        return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (
          !m.name.toLowerCase().includes(q) &&
          !m.email.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [members, filterPosition, filterLoad, onlyMine, search]);

  function toggleTeam(memberId: string, currently: boolean) {
    startTransition(async () => {
      const res = currently
        ? await removeFromPmTeamAction(memberId)
        : await addToPmTeamAction(memberId);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Поиск
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Имя или email"
            className="h-9 w-56 rounded-md border border-input bg-background px-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Должность
          </span>
          <select
            value={filterPosition}
            onChange={(e) => setFilterPosition((e.target.value || '') as Position | '')}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Любая</option>
            {ALL_POSITIONS.map((p) => (
              <option key={p} value={p}>
                {POSITION_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Загрузка
          </span>
          <select
            value={filterLoad}
            onChange={(e) => setFilterLoad((e.target.value || '') as '' | 'free' | 'busy')}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Все</option>
            <option value="free">Свободные</option>
            <option value="busy">Занятые</option>
          </select>
        </label>
        <label className="inline-flex cursor-pointer items-center gap-2 self-end pb-1 text-sm">
          <input
            type="checkbox"
            checked={onlyMine}
            onChange={(e) => setOnlyMine(e.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          Только моя команда
        </label>
      </div>

      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {filtered.length === 0 ? (
          <li className="p-6 text-center text-sm text-muted-foreground">
            Никого не нашлось под текущие фильтры.
          </li>
        ) : (
          filtered.map((m) => (
            <li key={m.id} className="flex items-center gap-3 p-3 text-sm">
              <Avatar src={m.image} alt={m.name} className="h-8 w-8" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate font-medium">{m.name}</span>
                  {m.inMyTeam ? (
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-800">
                      В моей команде
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                  <span>{m.email}</span>
                  {m.positions.length > 0 ? (
                    <span>
                      {m.positions.map((p) => POSITION_LABELS[p]).join(' · ')}
                    </span>
                  ) : null}
                  {m.alsoInPmIds.length > 0 ? (
                    <span title="Также в команде у:">
                      Также у:{' '}
                      {m.alsoInPmIds
                        .map((id) => pmsById[id] ?? id.slice(0, 6))
                        .join(', ')}
                    </span>
                  ) : null}
                </div>
              </div>
              <LoadBadge
                tasks={m.activeTaskCount}
                assignments={m.activeAssignmentCount}
              />
              <button
                type="button"
                onClick={() => toggleTeam(m.id, m.inMyTeam)}
                disabled={pending}
                className={
                  'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs disabled:opacity-50 ' +
                  (m.inMyTeam
                    ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                    : 'border-input text-muted-foreground hover:bg-accent')
                }
              >
                {m.inMyTeam ? (
                  <>
                    <UserMinus className="h-3 w-3" />
                    Убрать
                  </>
                ) : (
                  <>
                    <UserPlus className="h-3 w-3" />
                    В мою команду
                  </>
                )}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function LoadBadge({ tasks, assignments }: { tasks: number; assignments: number }) {
  // Sum is the rough indicator. We don't dedupe tasks counted in both
  // places — the legacy assigneeId path and the new TaskAssignment
  // table — because doing it precisely would need a DB join here, and
  // the rough number is good enough for "free or busy" decisioning.
  const total = tasks + assignments;
  const cls =
    total === 0
      ? 'bg-emerald-100 text-emerald-800'
      : total <= 2
        ? 'bg-amber-100 text-amber-800'
        : 'bg-red-100 text-red-800';
  const label =
    total === 0 ? 'свободен' : total === 1 ? '1 задача' : `${total} задач`;
  return (
    <span
      className={'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ' + cls}
      title="Активных задач (включая мульти-роли)"
    >
      <Users className="h-3 w-3" />
      {label}
    </span>
  );
}
