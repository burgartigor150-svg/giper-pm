'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@giper/ui/components/Input';
import { useT } from '@/lib/useT';
import type { UserSearchHit } from '@/actions/users';
import { TagPill } from './TagPill';

const STATUSES = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'TESTING', 'REVIEW', 'BLOCKED', 'DONE', 'CANCELED'] as const;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const TYPES = ['TASK', 'BUG', 'FEATURE', 'EPIC', 'CHORE'] as const;
const TYPE_LABELS: Record<(typeof TYPES)[number], string> = {
  TASK: 'Задача',
  BUG: 'Баг',
  FEATURE: 'Фича',
  EPIC: 'Эпик',
  CHORE: 'Рутина',
};
const DUE_OPTIONS = [
  { value: 'overdue', label: 'Просрочено' },
  { value: 'today', label: 'Сегодня' },
  { value: '7', label: 'В течение 7 дней' },
  { value: '30', label: 'В течение 30 дней' },
] as const;

type TagOption = { id: string; name: string; color: string };
type VersionOption = { id: string; name: string };

type Props = {
  status: string | undefined;
  priority: string | undefined;
  assigneeId: string | undefined;
  q: string | undefined;
  type?: string | undefined;
  dueWithin?: string | undefined;
  reviewer?: string | undefined;
  tester?: string | undefined;
  versionId?: string | undefined;
  versions?: VersionOption[];
  componentId?: string | undefined;
  components?: VersionOption[];
  members: UserSearchHit[];
  availableTags?: TagOption[];
  activeTagIds?: string[];
};

/**
 * Filter bar above the task table.
 *
 * Design rules from MASTER.md applied here:
 *  - §8 forms: every native <select> has a visible label sitting above
 *    (not inline), not placeholder-as-label
 *  - §7 touch: select/input height ≥40px (h-10)
 *  - §1 palette: tag chips active state uses the foreground ring, not
 *    the previous out-of-palette ring-blue-500
 *  - §9.7 chips: each active tag chip has its own X-close affordance;
 *    a separate "Сбросить теги" button still clears all in one click
 *  - §11 anti-pattern: pagination + filter `router.push` use
 *    scroll: false so the table doesn't jump to the top on every
 *    toggle
 */
export function TaskFilters({
  status,
  priority,
  assigneeId,
  q,
  type,
  dueWithin,
  reviewer,
  tester,
  versionId,
  versions = [],
  componentId,
  components = [],
  members,
  availableTags = [],
  activeTagIds = [],
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const tFilters = useT('tasks.list.filters');
  const tList = useT('tasks.list');
  const tStatus = useT('tasks.status');
  const tPrio = useT('tasks.priority');

  const [query, setQuery] = useState(q ?? '');

  function pushParams(mut: (sp: URLSearchParams) => void) {
    const next = new URLSearchParams(params.toString());
    mut(next);
    next.delete('page'); // any filter change resets pagination
    startTransition(() => {
      router.push(`?${next.toString()}`, { scroll: false });
    });
  }

  const toggleTag = (tagId: string) =>
    pushParams((sp) => {
      const current = new Set(activeTagIds);
      if (current.has(tagId)) current.delete(tagId);
      else current.add(tagId);
      sp.delete('tagIds');
      if (current.size > 0) {
        sp.set('tagIds', Array.from(current).join(','));
      }
    });

  // Common classes for native <select>. The styled <Select> from shadcn
  // would be nicer here but it's a larger refactor — for now we make
  // the native control comfortable (h-10) and keyboard-friendly with
  // a visible focus ring.
  const selectClass =
    'h-10 w-full rounded-md border border-input bg-background px-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div
      className={pending ? 'opacity-60' : ''}
      aria-busy={pending}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="task-filter-q" className="text-xs font-medium text-muted-foreground">
            {tList('search')}
          </label>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              pushParams((sp) => {
                if (query) sp.set('q', query);
                else sp.delete('q');
              });
            }}
          >
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="task-filter-q"
                type="search"
                aria-label={tList('search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-10 pl-9"
              />
            </div>
          </form>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="task-filter-status" className="text-xs font-medium text-muted-foreground">
            {tFilters('status')}
          </label>
          <select
            id="task-filter-status"
            value={status ?? ''}
            onChange={(e) =>
              pushParams((sp) => {
                if (e.target.value) sp.set('status', e.target.value);
                else sp.delete('status');
              })
            }
            className={selectClass}
          >
            <option value="">{tList('all')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {tStatus(s)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="task-filter-priority" className="text-xs font-medium text-muted-foreground">
            {tFilters('priority')}
          </label>
          <select
            id="task-filter-priority"
            value={priority ?? ''}
            onChange={(e) =>
              pushParams((sp) => {
                if (e.target.value) sp.set('priority', e.target.value);
                else sp.delete('priority');
              })
            }
            className={selectClass}
          >
            <option value="">{tList('all')}</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {tPrio(p)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="task-filter-assignee" className="text-xs font-medium text-muted-foreground">
            {tFilters('assignee')}
          </label>
          <select
            id="task-filter-assignee"
            value={assigneeId ?? ''}
            onChange={(e) =>
              pushParams((sp) => {
                if (e.target.value) sp.set('assigneeId', e.target.value);
                else sp.delete('assigneeId');
              })
            }
            className={selectClass}
          >
            <option value="">{tFilters('anyAssignee')}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="task-filter-type" className="text-xs font-medium text-muted-foreground">
            Тип
          </label>
          <select
            id="task-filter-type"
            value={type ?? ''}
            onChange={(e) =>
              pushParams((sp) => {
                if (e.target.value) sp.set('type', e.target.value);
                else sp.delete('type');
              })
            }
            className={selectClass}
          >
            <option value="">{tList('all')}</option>
            {TYPES.map((tp) => (
              <option key={tp} value={tp}>
                {TYPE_LABELS[tp]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="task-filter-due" className="text-xs font-medium text-muted-foreground">
            Срок
          </label>
          <select
            id="task-filter-due"
            value={dueWithin ?? ''}
            onChange={(e) =>
              pushParams((sp) => {
                if (e.target.value) sp.set('dueWithin', e.target.value);
                else sp.delete('dueWithin');
              })
            }
            className={selectClass}
          >
            <option value="">{tList('all')}</option>
            {DUE_OPTIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        {versions.length > 0 ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="task-filter-version" className="text-xs font-medium text-muted-foreground">
              Версия
            </label>
            <select
              id="task-filter-version"
              value={versionId ?? ''}
              onChange={(e) =>
                pushParams((sp) => {
                  if (e.target.value) sp.set('versionId', e.target.value);
                  else sp.delete('versionId');
                })
              }
              className={selectClass}
            >
              <option value="">{tList('all')}</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {components.length > 0 ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="task-filter-component" className="text-xs font-medium text-muted-foreground">
              Компонент
            </label>
            <select
              id="task-filter-component"
              value={componentId ?? ''}
              onChange={(e) =>
                pushParams((sp) => {
                  if (e.target.value) sp.set('componentId', e.target.value);
                  else sp.delete('componentId');
                })
              }
              className={selectClass}
            >
              <option value="">{tList('all')}</option>
              {components.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="flex items-end">
          <label className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={reviewer === 'me'}
              onChange={(e) =>
                pushParams((sp) => {
                  if (e.target.checked) sp.set('reviewer', 'me');
                  else sp.delete('reviewer');
                })
              }
            />
            На моём ревью
          </label>
        </div>

        <div className="flex items-end">
          <label className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={tester === 'me'}
              onChange={(e) =>
                pushParams((sp) => {
                  if (e.target.checked) sp.set('tester', 'me');
                  else sp.delete('tester');
                })
              }
            />
            Мои на QA
          </label>
        </div>
      </div>

      {availableTags.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Теги:</span>
          {availableTags.map((tag) => {
            const active = activeTagIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggleTag(tag.id)}
                className={[
                  'rounded-full transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                  active
                    ? 'ring-2 ring-foreground ring-offset-1'
                    : 'opacity-60 hover:opacity-100',
                ].join(' ')}
                aria-pressed={active}
                aria-label={`${tag.name}${active ? ' — нажмите чтобы убрать' : ' — нажмите чтобы добавить фильтр'}`}
              >
                <TagPill name={tag.name} color={tag.color} />
              </button>
            );
          })}
          {activeTagIds.length > 0 ? (
            <button
              type="button"
              onClick={() => pushParams((sp) => sp.delete('tagIds'))}
              className="ml-1 inline-flex items-center gap-1 rounded text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Сбросить фильтр по тегам"
            >
              <X className="size-3.5" aria-hidden="true" />
              сбросить
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
