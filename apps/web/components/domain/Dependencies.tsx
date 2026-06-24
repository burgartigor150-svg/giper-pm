'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Ban, Plus, X } from 'lucide-react';
import { TaskStatusBadge } from './TaskStatusBadge';
import type { TaskStatus, TaskLinkType } from '@giper/db';
import {
  addDependencyAction,
  removeDependencyAction,
} from '@/actions/dependencies';
import { searchTasks, type TaskSearchHit } from '@/actions/tasks';
import { isTerminal, statusCategory } from '@/lib/status/category';

type Edge = {
  id: string;
  /**
   * Whether the X (remove) control may show. removeDependencyAction gates on the
   * edge's fromTask, so only OUTGOING edges (current task = fromTask) are
   * removable from this page; incoming edges are removed from the other side.
   */
  removable?: boolean;
  task: {
    id: string;
    number: number;
    title: string;
    status: TaskStatus;
    project: { key: string };
  };
};

type Props = {
  taskId: string;
  projectKey: string;
  taskNumber: number;
  /** Tasks this one BLOCKS — outgoing BLOCKS edges. */
  blocks: Edge[];
  /** Tasks that block this one — incoming BLOCKS edges. */
  blockedBy: Edge[];
  /** Non-blocking related tasks (RELATES_TO, either direction). */
  relates: Edge[];
  /** Tasks this one duplicates (outgoing DUPLICATES). */
  duplicates: Edge[];
  /** Tasks that duplicate this one (incoming DUPLICATES). */
  duplicatedBy: Edge[];
  canEdit: boolean;
};

/**
 * Task relations panel. BLOCKS drives the blocked-state machine (red box +
 * auto-unblock); RELATES_TO and DUPLICATES are soft, display-only links. A
 * single adder at the bottom lets the user pick the link kind.
 */
export function Dependencies({
  taskId,
  projectKey,
  taskNumber,
  blocks,
  blockedBy,
  relates,
  duplicates,
  duplicatedBy,
  canEdit,
}: Props) {
  const openBlockedBy = blockedBy.filter(
    (e) => !isTerminal(statusCategory(e.task.status)),
  );

  return (
    <div className="flex flex-col gap-4">
      {openBlockedBy.length > 0 ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-red-900">
            <Ban className="h-4 w-4" />
            Заблокирована задачами ({openBlockedBy.length})
          </div>
          <ul className="mt-2 flex flex-col gap-1">
            {openBlockedBy.map((e) => (
              <EdgeRow key={e.id} edge={e} canRemove={false} projectKey={projectKey} taskNumber={taskNumber} />
            ))}
          </ul>
        </div>
      ) : null}

      {blockedBy.length > openBlockedBy.length ? (
        <DetailsSection title={`Уже не блокируют (${blockedBy.length - openBlockedBy.length})`}>
          <ul className="flex flex-col gap-1">
            {blockedBy
              .filter((e) => isTerminal(statusCategory(e.task.status)))
              .map((e) => (
                <EdgeRow key={e.id} edge={e} canRemove={false} projectKey={projectKey} taskNumber={taskNumber} />
              ))}
          </ul>
        </DetailsSection>
      ) : null}

      <Section title="Блокирует" edges={blocks} empty="Никого не блокирует." canEdit={canEdit} projectKey={projectKey} taskNumber={taskNumber} />

      {relates.length > 0 ? (
        <Section title="Связанные" edges={relates} canEdit={canEdit} projectKey={projectKey} taskNumber={taskNumber} />
      ) : null}
      {duplicates.length > 0 ? (
        <Section title="Дублирует" edges={duplicates} canEdit={canEdit} projectKey={projectKey} taskNumber={taskNumber} />
      ) : null}
      {duplicatedBy.length > 0 ? (
        <Section title="Дубликаты этой задачи" edges={duplicatedBy} canEdit={canEdit} projectKey={projectKey} taskNumber={taskNumber} />
      ) : null}

      {canEdit ? (
        <AddLink fromTaskId={taskId} projectKey={projectKey} taskNumber={taskNumber} />
      ) : null}
    </div>
  );
}

function Section({
  title,
  edges,
  empty,
  canEdit,
  projectKey,
  taskNumber,
}: {
  title: string;
  edges: Edge[];
  empty?: string;
  canEdit: boolean;
  projectKey: string;
  taskNumber: number;
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
      {edges.length === 0 ? (
        empty ? <p className="text-sm text-muted-foreground">{empty}</p> : null
      ) : (
        <ul className="flex flex-col gap-1">
          {edges.map((e) => (
            <EdgeRow
              key={e.id}
              edge={e}
              canRemove={canEdit && (e.removable ?? false)}
              projectKey={projectKey}
              taskNumber={taskNumber}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function EdgeRow({
  edge,
  canRemove,
  projectKey,
  taskNumber,
}: {
  edge: Edge;
  canRemove: boolean;
  projectKey: string;
  taskNumber: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function remove() {
    startTransition(async () => {
      const res = await removeDependencyAction(edge.id, projectKey, taskNumber);
      if (!res.ok) {
        alert(res.error.message);
        return;
      }
      router.refresh();
    });
  }
  return (
    <li className="group flex items-center gap-2">
      <Link
        href={`/projects/${edge.task.project.key}/tasks/${edge.task.number}`}
        className="flex flex-1 items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent"
      >
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {edge.task.project.key}-{edge.task.number}
        </span>
        <span className="flex-1 truncate">{edge.task.title}</span>
        <TaskStatusBadge status={edge.task.status} />
      </Link>
      {canRemove ? (
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          aria-label="Убрать связь"
          className="text-muted-foreground opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100 disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </li>
  );
}

function DetailsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">{title}</summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

const LINK_OPTIONS: { value: TaskLinkType; label: string }[] = [
  { value: 'BLOCKS', label: 'Блокирует' },
  { value: 'RELATES_TO', label: 'Связана с' },
  { value: 'DUPLICATES', label: 'Дублирует' },
];

function AddLink({
  fromTaskId,
  projectKey,
  taskNumber,
}: {
  fromTaskId: string;
  projectKey: string;
  taskNumber: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [linkType, setLinkType] = useState<TaskLinkType>('BLOCKS');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TaskSearchHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function search(q: string) {
    setQuery(q);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    searchTasks(q).then(setResults);
  }

  function pick(taskId: string) {
    setError(null);
    startTransition(async () => {
      const res = await addDependencyAction(fromTaskId, taskId, projectKey, taskNumber, linkType);
      if (!res.ok) {
        setError(res.error.message);
      } else {
        setOpen(false);
        setQuery('');
        setResults([]);
        router.refresh();
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 inline-flex items-center gap-1 self-start rounded-md border border-dashed border-input px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Plus className="h-3 w-3" />
        Добавить связь
      </button>
    );
  }

  const visible = results.filter((r) => r.id !== fromTaskId);

  return (
    <div className="mt-1 rounded-md border border-input bg-background p-2">
      <div className="flex items-center gap-2">
        <select
          value={linkType}
          onChange={(e) => setLinkType(e.target.value as TaskLinkType)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          aria-label="Тип связи"
        >
          {LINK_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          autoFocus
          value={query}
          onChange={(e) => search(e.target.value)}
          placeholder="Найти задачу"
          className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm outline-none"
        />
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setQuery('');
            setError(null);
          }}
          className="text-xs text-muted-foreground hover:underline"
        >
          Отмена
        </button>
      </div>
      {visible.length > 0 ? (
        <ul className="mt-2 flex max-h-48 flex-col overflow-y-auto rounded-md border border-input bg-background">
          {visible.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                disabled={pending}
                onClick={() => pick(r.id)}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {r.projectKey}-{r.number}
                </span>
                <span className="flex-1 truncate">{r.title}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : query.trim().length >= 2 ? (
        <p className="mt-2 text-xs text-muted-foreground">Ничего не найдено</p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">Минимум 2 символа</p>
      )}
      {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
