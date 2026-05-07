'use client';

import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { cn } from '@giper/ui/cn';
import { Button } from '@giper/ui/components/Button';
import { useT } from '@/lib/useT';
import type { BoardTask } from '@/lib/tasks';
import { KanbanCard } from './KanbanCard';

type Status = BoardTask['status'];

type Props = {
  projectKey: string;
  status: Status;
  tasks: BoardTask[];
  /** When provided, only first `cap` tasks render until the user expands. */
  cap?: number;
  /** Soft WIP limit for this column. Exceeding it paints the header red. */
  wipLimit?: number | null;
};

const COLUMN_BG: Record<Exclude<Status, 'CANCELED'>, string> = {
  BACKLOG: 'border-neutral-200',
  TODO: 'border-sky-200',
  IN_PROGRESS: 'border-blue-200',
  REVIEW: 'border-amber-200',
  BLOCKED: 'border-red-200',
  DONE: 'border-green-200',
};

export function KanbanColumn({ projectKey, status, tasks, cap, wipLimit }: Props) {
  const tStatus = useT('tasks.status');
  const tBoard = useT('tasks.board');

  const [showAll, setShowAll] = useState(false);
  const visible = cap && !showAll ? tasks.slice(0, cap) : tasks;
  const hidden = tasks.length - visible.length;
  const overLimit = wipLimit != null && tasks.length > wipLimit;

  const { setNodeRef, isOver } = useDroppable({
    id: `column-${status}`,
    data: { type: 'column', status },
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
          {tStatus(status)}
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
