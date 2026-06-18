'use client';

import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { cn } from '@giper/ui/cn';
import { Button } from '@giper/ui/components/Button';
import { useT } from '@/lib/useT';
import type { BoardTask, BoardSubColumnView } from '@/lib/tasks';
import { KanbanCard } from './KanbanCard';

type Status = BoardTask['status'];
const NO_LANE = 'none';

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
  return props.subColumns && props.subColumns.length > 0 ? (
    <SubColumnedColumn {...props} subColumns={props.subColumns} />
  ) : (
    <PlainColumn {...props} />
  );
}

function PlainColumn({ projectKey, status, name, tasks, cap, wipLimit, laneKey }: Props) {
  const tStatus = useT('tasks.status');
  const tBoard = useT('tasks.board');

  const [showAll, setShowAll] = useState(false);
  const visible = cap && !showAll ? tasks.slice(0, cap) : tasks;
  const hidden = tasks.length - visible.length;
  const overLimit = wipLimit != null && tasks.length > wipLimit;

  // Single-lane mode keeps the original `column-<status>` droppable id (so the
  // existing board + e2e are unchanged); band mode scopes it to the lane.
  const { setNodeRef, isOver } = useDroppable({
    id: laneKey ? `cell-${laneKey}-${status}` : `column-${status}`,
    data: { type: 'column', status, laneKey },
  });

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
          'flex items-center justify-between border-b px-3 py-2 text-sm',
          overLimit ? 'border-red-300 bg-red-50' : 'border-border',
        )}
      >
        <span className={cn('font-medium', overLimit ? 'text-red-900' : '')}>
          {name ?? tStatus(status)}
        </span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs tabular-nums',
            overLimit
              ? 'bg-red-200 text-red-900'
              : 'bg-background text-muted-foreground',
          )}
          title={
            wipLimit != null
              ? `WIP-лимит: ${wipLimit}${overLimit ? ` — превышен на ${tasks.length - wipLimit}` : ''}`
              : undefined
          }
        >
          {wipLimit != null ? `${tasks.length}/${wipLimit}` : tasks.length}
        </span>
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
