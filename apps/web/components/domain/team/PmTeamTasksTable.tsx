'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { ExternalLink } from 'lucide-react';
import { Avatar } from '@giper/ui/components/Avatar';
import { TaskStatusBadge } from '../TaskStatusBadge';
import type { PmTeamTaskRow } from '@/lib/teams/listPmTeamTasks';

type TeamLite = { id: string; name: string };

type Props = {
  tasks: PmTeamTaskRow[];
  team: TeamLite[];
  activeFilter: {
    memberId?: string;
    source?: 'bitrix' | 'local';
    onlyOpen: boolean;
  };
};

/**
 * URL-driven table for the PM's team task feed. Three filters:
 *   - member dropdown (resolved against the PM's roster)
 *   - source (Bitrix mirror vs local)
 *   - "show closed too" checkbox (default off — PMs want active work)
 *
 * Same pattern as /reports — every change patches the URL via
 * router.push so the result is shareable / linkable, and RSC re-runs
 * the query.
 */
export function PmTeamTasksTable({ tasks, team, activeFilter }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  function patch(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === '') params.delete(k);
      else params.set(k, v);
    }
    startTransition(() => router.push(`?${params.toString()}`));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Участник
          </span>
          <select
            value={activeFilter.memberId ?? ''}
            onChange={(e) => patch({ memberId: e.target.value || undefined })}
            disabled={pending}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Все из моей команды</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Источник
          </span>
          <select
            value={activeFilter.source ?? ''}
            onChange={(e) =>
              patch({
                source:
                  e.target.value === 'bitrix' || e.target.value === 'local'
                    ? e.target.value
                    : undefined,
              })
            }
            disabled={pending}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Все</option>
            <option value="bitrix">Bitrix24</option>
            <option value="local">Внутренние</option>
          </select>
        </label>
        <label className="inline-flex cursor-pointer items-center gap-2 self-end pb-1 text-sm">
          <input
            type="checkbox"
            checked={!activeFilter.onlyOpen}
            onChange={(e) => patch({ onlyOpen: e.target.checked ? '0' : undefined })}
            className="h-4 w-4 rounded border-input"
          />
          Показывать закрытые
        </label>
      </div>

      {tasks.length === 0 ? (
        <p className="rounded-md border border-border bg-background py-6 text-center text-sm text-muted-foreground">
          Под текущие фильтры нет задач.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-background">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Задача</th>
                <th className="px-3 py-2 font-medium">Проект</th>
                <th className="px-3 py-2 font-medium">Статус (внутр.)</th>
                <th className="px-3 py-2 font-medium">Bitrix статус</th>
                <th className="px-3 py-2 font-medium">Команда</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">Срок</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => {
                const isMirror = t.externalSource === 'bitrix24';
                return (
                  <tr key={t.id} className="border-t border-border align-top">
                    <td className="px-3 py-2">
                      <Link
                        href={`/projects/${t.project.key}/tasks/${t.number}`}
                        className="hover:underline"
                      >
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {t.project.key}-{t.number}
                        </span>{' '}
                        {t.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono">
                        {t.project.key}
                      </span>{' '}
                      <span className="text-muted-foreground">{t.project.name}</span>
                    </td>
                    <td className="px-3 py-2">
                      <TaskStatusBadge status={t.internalStatus} />
                    </td>
                    <td className="px-3 py-2">
                      {isMirror ? (
                        <span className="inline-flex items-center gap-1 text-xs text-blue-700">
                          <ExternalLink className="h-3 w-3" />
                          <TaskStatusBadge status={t.status} />
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <TeamCell row={t} />
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {t.dueDate
                        ? new Date(t.dueDate).toLocaleDateString('ru-RU')
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TeamCell({ row }: { row: PmTeamTaskRow }) {
  // Show the legacy primary assignee + every multi-role assignment.
  // Role tag goes after the name when a role is known.
  const seen = new Set<string>();
  const items: { id: string; name: string; image: string | null; role?: string }[] = [];
  if (row.assignee) {
    items.push({
      id: row.assignee.id,
      name: row.assignee.name,
      image: row.assignee.image,
    });
    seen.add(row.assignee.id);
  }
  for (const a of row.assignments) {
    if (seen.has(a.user.id)) {
      // Annotate the existing entry with the role from this assignment.
      const existing = items.find((it) => it.id === a.user.id);
      if (existing && !existing.role) existing.role = a.position;
      continue;
    }
    items.push({
      id: a.user.id,
      name: a.user.name,
      image: a.user.image,
      role: a.position,
    });
    seen.add(a.user.id);
  }
  if (items.length === 0)
    return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((p) => (
        <span
          key={p.id}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-background pl-0.5 pr-1.5 text-xs"
          title={p.role ? `${p.name} · ${p.role}` : p.name}
        >
          <Avatar src={p.image} alt={p.name} className="h-4 w-4" />
          <span className="truncate max-w-[120px]">{p.name}</span>
          {p.role ? (
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {p.role}
            </span>
          ) : null}
        </span>
      ))}
    </div>
  );
}
