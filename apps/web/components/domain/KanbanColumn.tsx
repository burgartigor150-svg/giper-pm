'use client';

import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ChevronLeft, ChevronRight, Check, X, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@giper/ui/cn';
import { Button } from '@giper/ui/components/Button';
import { useT } from '@/lib/useT';
import type { BoardTask, BoardSubColumnView } from '@/lib/tasks';
import type { StatusCategory } from '@giper/db';
import { KanbanCard } from './KanbanCard';

type Status = BoardTask['status'];
const NO_LANE = 'none';

/**
 * Column "type" options (Kaiten: the type drives card status, not the name).
 * CANCELED is omitted — a CANCELED column is hidden from the board, so it isn't
 * a sensible re-type target (the server action rejects it too).
 */
const COLUMN_TYPE_OPTIONS: { value: StatusCategory; label: string }[] = [
  { value: 'BACKLOG', label: 'Бэклог' },
  { value: 'TODO', label: 'К работе' },
  { value: 'IN_PROGRESS', label: 'В работе' },
  { value: 'REVIEW', label: 'Ревью' },
  { value: 'BLOCKED', label: 'Заблок.' },
  { value: 'DONE', label: 'Готово' },
];

type Props = {
  projectKey: string;
  status: Status;
  /** Display label. Falls back to the i18n status name for default columns. */
  name?: string;
  tasks: BoardTask[];
  /** When provided, only first `cap` tasks render until the user expands. */
  cap?: number;
  /** Soft WIP limit for this column. Exceeding it paints the header red. */
  wipLimit?: number | null;
  /** Swimlane key when rendered inside a band; omitted in single-lane mode. */
  laneKey?: string;
  /** Sub-columns under this column; when present, the column splits into them. */
  subColumns?: BoardSubColumnView[];
  /** First-class column id (S6). Used as the droppable key in free-form mode. */
  columnId?: string;
  /** Free-form mode: address the droppable by columnId (two columns can share a status). */
  useColumnId?: boolean;
  /** Free-form management controls (rename / delete / reorder) in the header. */
  canManageColumns?: boolean;
  onRenameColumn?: (columnId: string, name: string) => void;
  onDeleteColumn?: (columnId: string) => void;
  onMoveColumn?: (columnId: string, dir: -1 | 1) => void;
  /** Change the column's TYPE (status category) — cascades cards to it. */
  onSetColumnCategory?: (columnId: string, category: StatusCategory) => void;
  /** Disable ← / → at the ends of the row. */
  isFirstColumn?: boolean;
  isLastColumn?: boolean;
};

const COLUMN_BG: Record<Exclude<Status, 'CANCELED'>, string> = {
  BACKLOG: 'border-neutral-200',
  TODO: 'border-sky-200',
  IN_PROGRESS: 'border-blue-200',
  REVIEW: 'border-amber-200',
  BLOCKED: 'border-red-200',
  DONE: 'border-green-200',
};

/**
 * Delegator: a column with no sub-columns renders exactly as before
 * (PlainColumn, byte-identical droppable ids); a column with sub-columns splits
 * into per-sub-column drop zones. The branch keeps hooks unconditional by
 * living in two sibling components.
 */
export function KanbanColumn(props: Props) {
  // Free-form mode renders columns flat: sub-columns aren't part of the
  // columnId-keyed DnD model (a card dropped on a sub-zone would resolve to no
  // columnId target and be silently swallowed), so suppress them there.
  const withSubs = !props.useColumnId && props.subColumns && props.subColumns.length > 0;
  return withSubs ? (
    <SubColumnedColumn {...props} subColumns={props.subColumns!} />
  ) : (
    <PlainColumn {...props} />
  );
}

function PlainColumn({
  projectKey,
  status,
  name,
  tasks,
  cap,
  wipLimit,
  laneKey,
  columnId,
  useColumnId,
  canManageColumns,
  onRenameColumn,
  onDeleteColumn,
  onMoveColumn,
  onSetColumnCategory,
  isFirstColumn,
  isLastColumn,
}: Props) {
  const tStatus = useT('tasks.status');
  const tBoard = useT('tasks.board');

  const [showAll, setShowAll] = useState(false);
  const visible = cap && !showAll ? tasks.slice(0, cap) : tasks;
  const hidden = tasks.length - visible.length;
  const overLimit = wipLimit != null && tasks.length > wipLimit;

  // Inline-rename state (kept unconditional so hooks are stable).
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name ?? '');

  // Free-form mode keys the droppable by columnId (two columns can share a
  // status); otherwise the original `column-<status>` id is preserved byte-for-
  // byte, so non-free-form boards + e2e are unchanged. Band mode scopes to lane.
  const dropKey = useColumnId && columnId ? columnId : status;
  const { setNodeRef, isOver } = useDroppable({
    id: laneKey ? `cell-${laneKey}-${dropKey}` : `column-${dropKey}`,
    data: { type: 'column', status, laneKey, columnId },
  });

  const manageable = Boolean(canManageColumns && columnId);
  const commitRename = () => {
    const clean = draft.trim();
    setEditing(false);
    if (clean && clean !== name && columnId) onRenameColumn?.(columnId, clean);
    else setDraft(name ?? '');
  };

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-md border-2 bg-muted/30 transition-colors',
        COLUMN_BG[status as Exclude<Status, 'CANCELED'>],
        isOver ? 'bg-muted/60' : '',
      )}
    >
      <div
        className={cn(
          'flex items-center justify-between gap-1 border-b px-3 py-2 text-sm',
          overLimit ? 'border-red-300 bg-red-50' : 'border-border',
        )}
      >
        {editing && manageable ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') {
                setEditing(false);
                setDraft(name ?? '');
              }
            }}
            maxLength={60}
            className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-sm"
          />
        ) : (
          <button
            type="button"
            disabled={!manageable}
            onClick={() => {
              if (!manageable) return;
              setDraft(name ?? '');
              setEditing(true);
            }}
            className={cn(
              'group flex min-w-0 items-center gap-1 truncate text-left font-medium',
              overLimit ? 'text-red-900' : '',
              manageable ? 'hover:underline' : 'cursor-default',
            )}
            title={manageable ? 'Переименовать колонку' : undefined}
          >
            <span className="truncate">{name ?? tStatus(status)}</span>
            {manageable ? (
              <Pencil className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60" />
            ) : null}
          </button>
        )}
        <div className="flex shrink-0 items-center gap-0.5">
          {manageable && !editing && onSetColumnCategory ? (
            <select
              value={status}
              onChange={(e) =>
                columnId && onSetColumnCategory(columnId, e.target.value as StatusCategory)
              }
              className="mr-0.5 max-w-[5.5rem] rounded border border-border bg-background px-1 py-0.5 text-xs text-muted-foreground"
              title="Тип колонки (категория) — изменит статус карточек в ней"
              aria-label="Тип колонки"
            >
              {COLUMN_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : null}
          {manageable && !editing ? (
            <>
              <button
                type="button"
                disabled={isFirstColumn}
                onClick={() => columnId && onMoveColumn?.(columnId, -1)}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                title="Левее"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={isLastColumn}
                onClick={() => columnId && onMoveColumn?.(columnId, 1)}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                title="Правее"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => columnId && onDeleteColumn?.(columnId)}
                className="rounded p-0.5 text-muted-foreground hover:bg-red-100 hover:text-red-700"
                title="Удалить колонку"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          ) : null}
          {editing && manageable ? (
            <>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={commitRename} className="rounded p-0.5 text-green-700 hover:bg-green-100" title="Сохранить">
                <Check className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setEditing(false);
                  setDraft(name ?? '');
                }}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                title="Отмена"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs tabular-nums',
                overLimit ? 'bg-red-200 text-red-900' : 'bg-background text-muted-foreground',
              )}
              title={
                wipLimit != null
                  ? `WIP-лимит: ${wipLimit}${overLimit ? ` — превышен на ${tasks.length - wipLimit}` : ''}`
                  : undefined
              }
            >
              {wipLimit != null ? `${tasks.length}/${wipLimit}` : tasks.length}
            </span>
          )}
        </div>
      </div>

      <SortableContext
        items={visible.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-1 flex-col gap-2 p-2">
          {visible.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
              {tBoard('empty')}
            </div>
          ) : (
            visible.map((task) => (
              <KanbanCard key={task.id} projectKey={projectKey} task={task} />
            ))
          )}
          {hidden > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setShowAll(true)}
              className="mt-1"
            >
              {tBoard('showMore', { count: hidden })}
            </Button>
          ) : null}
        </div>
      </SortableContext>
    </div>
  );
}

function SubColumnedColumn({
  projectKey,
  status,
  name,
  tasks,
  wipLimit,
  laneKey,
  subColumns,
}: Props & { subColumns: BoardSubColumnView[] }) {
  const tStatus = useT('tasks.status');
  const overLimit = wipLimit != null && tasks.length > wipLimit;

  // Bucket the column's tasks into its sub-columns. A card with no subColumnId
  // (or a stale one) falls back to the first sub-column for display.
  const firstId = subColumns[0]!.id;
  const bySub = new Map<string, BoardTask[]>();
  for (const s of subColumns) bySub.set(s.id, []);
  for (const t of tasks) {
    const key = t.subColumnId && bySub.has(t.subColumnId) ? t.subColumnId : firstId;
    bySub.get(key)!.push(t);
  }

  return (
    <div
      className={cn(
        'flex shrink-0 flex-col rounded-md border-2 bg-muted/30',
        COLUMN_BG[status as Exclude<Status, 'CANCELED'>],
      )}
    >
      <div
        className={cn(
          'flex items-center justify-between border-b px-3 py-2 text-sm',
          overLimit ? 'border-red-300 bg-red-50' : 'border-border',
        )}
      >
        <span className={cn('font-medium', overLimit ? 'text-red-900' : '')}>
          {name ?? tStatus(status)}
        </span>
        <span className="rounded-full bg-background px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
          {wipLimit != null ? `${tasks.length}/${wipLimit}` : tasks.length}
        </span>
      </div>
      <div className="flex gap-2 p-2">
        {subColumns.map((sub) => (
          <SubZone
            key={sub.id}
            projectKey={projectKey}
            status={status}
            laneKey={laneKey}
            sub={sub}
            tasks={bySub.get(sub.id) ?? []}
          />
        ))}
      </div>
    </div>
  );
}

function SubZone({
  projectKey,
  status,
  laneKey,
  sub,
  tasks,
}: {
  projectKey: string;
  status: Status;
  laneKey?: string;
  sub: BoardSubColumnView;
  tasks: BoardTask[];
}) {
  const tBoard = useT('tasks.board');
  const overLimit = sub.wipLimit != null && tasks.length > sub.wipLimit;
  const { setNodeRef, isOver } = useDroppable({
    id: `subcol-${laneKey ?? NO_LANE}-${status}-${sub.id}`,
    data: { type: 'subcolumn', status, laneKey, subColumnId: sub.id },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex w-56 shrink-0 flex-col rounded-md border bg-background/60 transition-colors',
        overLimit ? 'border-red-300' : 'border-border',
        isOver ? 'bg-muted/60' : '',
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-2 py-1 text-xs">
        <span className={cn('font-medium', overLimit ? 'text-red-900' : '')}>{sub.name}</span>
        <span
          className={cn(
            'rounded-full px-1.5 py-0.5 tabular-nums',
            overLimit ? 'bg-red-200 text-red-900' : 'text-muted-foreground',
          )}
          title={sub.wipLimit != null ? `WIP-лимит: ${sub.wipLimit}` : undefined}
        >
          {sub.wipLimit != null ? `${tasks.length}/${sub.wipLimit}` : tasks.length}
        </span>
      </div>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-1 flex-col gap-2 p-2">
          {tasks.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-2 text-center text-[11px] text-muted-foreground">
              {tBoard('empty')}
            </div>
          ) : (
            tasks.map((task) => (
              <KanbanCard key={task.id} projectKey={projectKey} task={task} />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}
