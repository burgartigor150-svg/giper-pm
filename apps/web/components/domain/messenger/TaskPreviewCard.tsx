import Link from 'next/link';
import { Avatar } from '@giper/ui/components/Avatar';
import { TaskStatusBadge } from '@/components/domain/TaskStatusBadge';
import { PriorityBadge } from '@/components/domain/PriorityBadge';
import type { TaskPreview } from '@/lib/tasks/loadTaskPreviews';

/**
 * Inline card under a chat message when its body references a task
 * (GPM-142, /projects/GPM/tasks/142, etc.). Three visual states:
 *
 *   1. Visible task → full card with title, status, priority,
 *      assignee, due date.
 *   2. Not visible (viewer has no stake) → muted stub showing only
 *      the key. We don't leak the title or any other field.
 *   3. Not found (typo / deleted task) → same muted stub.
 *
 * Each card is its own <Link> so keyboard + screen reader users
 * navigate to the task as a single tappable unit. Width is capped
 * so multiple cards stack neatly under a message instead of
 * stretching the bubble.
 */
export function TaskPreviewCard({ preview }: { preview: TaskPreview }) {
  const href = `/projects/${preview.projectKey}/tasks/${preview.number}`;
  if (!preview.visible) {
    // Stub for both "no access" and "not found" — we deliberately
    // don't distinguish them in the UI so the viewer can't probe
    // for the existence of tasks they can't see.
    return (
      <span
        className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-dashed border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground"
        title="Задача недоступна или не найдена"
      >
        <span className="font-mono tabular-nums">{preview.key}</span>
        <span>· нет доступа</span>
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="mt-1 flex max-w-md flex-col gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm transition-colors duration-150 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {preview.key}
        </span>
        <TaskStatusBadge
          status={
            preview.internalStatus as Parameters<typeof TaskStatusBadge>[0]['status']
          }
        />
        <PriorityBadge
          priority={
            preview.priority as Parameters<typeof PriorityBadge>[0]['priority']
          }
          iconOnly
        />
      </div>
      <div className="line-clamp-2 text-sm font-medium leading-snug">
        {preview.title}
      </div>
      {(preview.assignee || preview.dueDate) ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {preview.assignee ? (
            <span className="inline-flex items-center gap-1">
              <Avatar
                src={preview.assignee.image}
                alt={preview.assignee.name}
                className="size-4"
              />
              {preview.assignee.name}
            </span>
          ) : null}
          {preview.dueDate ? (
            <span className="tabular-nums">
              · до {new Date(preview.dueDate).toLocaleDateString('ru-RU')}
            </span>
          ) : null}
        </div>
      ) : null}
    </Link>
  );
}
