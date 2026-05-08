'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Input } from '@giper/ui/components/Input';
import { useT } from '@/lib/useT';
import type { UserSearchHit } from '@/actions/users';
import { TagPill } from './TagPill';

const STATUSES = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'BLOCKED', 'DONE', 'CANCELED'] as const;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

type TagOption = { id: string; name: string; color: string };

type Props = {
  status: string | undefined;
  priority: string | undefined;
  assigneeId: string | undefined;
  q: string | undefined;
  members: UserSearchHit[];
  availableTags?: TagOption[];
  activeTagIds?: string[];
};

export function TaskFilters({
  status,
  priority,
  assigneeId,
  q,
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
      router.push(`?${next.toString()}`);
    });
  }

  return (
    <div className={pending ? 'opacity-60' : ''}>
      <div className="flex flex-wrap items-center gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            pushParams((sp) => {
              if (query) sp.set('q', query);
              else sp.delete('q');
            });
          }}
          className="min-w-[220px] flex-1"
        >
          <Input
            type="search"
            placeholder={tList('search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>

        <label className="flex items-center gap-1 text-sm text-muted-foreground">
          <span>{tFilters('status')}:</span>
          <select
            value={status ?? ''}
            onChange={(e) =>
              pushParams((sp) => {
                if (e.target.value) sp.set('status', e.target.value);
                else sp.delete('status');
              })
            }
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">{tList('all')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {tStatus(s)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1 text-sm text-muted-foreground">
          <span>{tFilters('priority')}:</span>
          <select
            value={priority ?? ''}
            onChange={(e) =>
              pushParams((sp) => {
                if (e.target.value) sp.set('priority', e.target.value);
                else sp.delete('priority');
              })
            }
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">{tList('all')}</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {tPrio(p)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1 text-sm text-muted-foreground">
          <span>{tFilters('assignee')}:</span>
          <select
            value={assigneeId ?? ''}
            onChange={(e) =>
              pushParams((sp) => {
                if (e.target.value) sp.set('assigneeId', e.target.value);
                else sp.delete('assigneeId');
              })
            }
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">{tFilters('anyAssignee')}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {availableTags.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-sm text-muted-foreground">Теги:</span>
          {availableTags.map((tag) => {
            const active = activeTagIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() =>
                  pushParams((sp) => {
                    const current = new Set(activeTagIds);
                    if (active) current.delete(tag.id);
                    else current.add(tag.id);
                    sp.delete('tagIds');
                    if (current.size > 0) {
                      sp.set('tagIds', Array.from(current).join(','));
                    }
                  })
                }
                className={
                  active
                    ? 'rounded-full ring-2 ring-blue-500 ring-offset-1'
                    : 'opacity-60 hover:opacity-100'
                }
                aria-pressed={active}
              >
                <TagPill name={tag.name} color={tag.color} />
              </button>
            );
          })}
          {activeTagIds.length > 0 ? (
            <button
              type="button"
              onClick={() => pushParams((sp) => sp.delete('tagIds'))}
              className="ml-1 rounded text-xs text-muted-foreground hover:text-foreground"
            >
              сбросить
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
