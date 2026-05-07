'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Input } from '@giper/ui/components/Input';
import { useT } from '@/lib/useT';
import { TagPill } from './TagPill';

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

type Member = { id: string; name: string };
type TagOption = { id: string; name: string; color: string };

type Props = {
  members: Member[];
  assigneeId: string | undefined;
  priority: string | undefined;
  q: string | undefined;
  onlyMine: boolean;
  availableTags?: TagOption[];
  activeTagIds?: string[];
};

export function KanbanFilters({
  members,
  assigneeId,
  priority,
  q,
  onlyMine,
  availableTags = [],
  activeTagIds = [],
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const tBoard = useT('tasks.board.filters');
  const tCommon = useT('tasks.board');
  const tPrio = useT('tasks.priority');
  const tList = useT('tasks.list');

  const [query, setQuery] = useState(q ?? '');

  function pushParams(mut: (sp: URLSearchParams) => void) {
    const next = new URLSearchParams(params.toString());
    mut(next);
    startTransition(() => router.push(`?${next.toString()}`));
  }

  return (
    <div className={`flex flex-wrap items-center gap-3 ${pending ? 'opacity-60' : ''}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          pushParams((sp) => {
            if (query) sp.set('q', query);
            else sp.delete('q');
          });
        }}
        className="min-w-[200px] flex-1"
      >
        <Input
          type="search"
          placeholder={tBoard('search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </form>

      <label className="flex items-center gap-1 text-sm text-muted-foreground">
        <span>{tBoard('assignee')}:</span>
        <select
          value={assigneeId ?? ''}
          disabled={onlyMine}
          onChange={(e) =>
            pushParams((sp) => {
              if (e.target.value) sp.set('assigneeId', e.target.value);
              else sp.delete('assigneeId');
            })
          }
          className="h-8 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
        >
          <option value="">{tBoard('anyAssignee')}</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1 text-sm text-muted-foreground">
        <span>{tBoard('priority')}:</span>
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

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={onlyMine}
          onChange={(e) =>
            pushParams((sp) => {
              if (e.target.checked) sp.set('onlyMine', '1');
              else sp.delete('onlyMine');
            })
          }
        />
        {tCommon('onlyMine')}
      </label>

      {availableTags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
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
