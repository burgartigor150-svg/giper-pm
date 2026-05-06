'use client';

import Link from 'next/link';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Avatar } from '@giper/ui/components/Avatar';
import { cn } from '@giper/ui/cn';
import type { BoardTask } from '@/lib/tasks';

const PRIORITY_DOT: Record<NonNullable<BoardTask['priority']>, string> = {
  LOW: 'bg-neutral-400',
  MEDIUM: 'bg-sky-500',
  HIGH: 'bg-amber-500',
  URGENT: 'bg-red-500',
};

type Props = {
  projectKey: string;
  task: BoardTask;
  /** Show drag affordances (false on overlay clone). */
  isOverlay?: boolean;
};

export function KanbanCard({ projectKey, task, isOverlay = false }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'task', status: task.status },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging && !isOverlay ? 0.4 : 1,
  };

  const visibleTags = task.tags.slice(0, 2);
  const extraTags = task.tags.length - visibleTags.length;

  return (
    <div
      ref={isOverlay ? undefined : setNodeRef}
      style={isOverlay ? undefined : style}
      {...(isOverlay ? {} : attributes)}
      {...(isOverlay ? {} : listeners)}
      className={cn(
        'group cursor-grab touch-none rounded-md border border-border bg-background p-3 text-sm shadow-sm transition-shadow active:cursor-grabbing',
        isOverlay ? 'shadow-lg ring-2 ring-ring' : 'hover:shadow-md',
      )}
    >
      <div className="flex items-start gap-2">
        <span
          className={cn(
            'mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full',
            PRIORITY_DOT[task.priority],
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Link
              href={`/projects/${projectKey}/tasks/${task.number}`}
              className="font-mono hover:underline"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {projectKey}-{task.number}
            </Link>
            {task.estimateHours ? <span>· {task.estimateHours.toString()} ч</span> : null}
          </div>
          <Link
            href={`/projects/${projectKey}/tasks/${task.number}`}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="mt-1 block truncate font-medium hover:underline"
            title={task.title}
          >
            {task.title}
          </Link>
        </div>
      </div>

      {(visibleTags.length > 0 || task.assignee) ? (
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1">
            {visibleTags.map((t) => (
              <span
                key={t}
                className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {t}
              </span>
            ))}
            {extraTags > 0 ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                +{extraTags}
              </span>
            ) : null}
          </div>
          {task.assignee ? (
            <Avatar
              src={task.assignee.image}
              alt={task.assignee.name}
              className="h-6 w-6"
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
