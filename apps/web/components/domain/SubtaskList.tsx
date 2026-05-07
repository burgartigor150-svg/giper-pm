import Link from 'next/link';
import type { TaskStatus } from '@giper/db';
import { TaskStatusBadge } from './TaskStatusBadge';
import { Avatar } from '@giper/ui/components/Avatar';
import { AddSubtaskButton } from './AddSubtaskButton';

type Subtask = {
  id: string;
  number: number;
  title: string;
  status: TaskStatus;
  priority: string;
  assignee: { id: string; name: string; image: string | null } | null;
};

type Props = {
  projectKey: string;
  parentTaskId: string;
  subtasks: Subtask[];
  /** Render the inline "+ subtask" button. Only shown if the user can edit. */
  canAdd: boolean;
};

/**
 * Subtasks block on the parent task page. Lists every subtask with status,
 * assignee, and a roll-up progress bar at the top showing N done / total.
 *
 * Click "+ Подзадача" → opens QuickAddDialog pre-filled with the parent
 * task id; the dialog is the same one used by the C shortcut globally,
 * we just open it via a CustomEvent with extra args.
 */
export function SubtaskList({ projectKey, parentTaskId, subtasks, canAdd }: Props) {
  const total = subtasks.filter((s) => s.status !== 'CANCELED').length;
  const done = subtasks.filter((s) => s.status === 'DONE').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-3">
      {total > 0 ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between text-xs text-muted-foreground">
            <span>
              Готово {done} из {total}
            </span>
            <span className="font-mono tabular-nums">{pct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      ) : null}

      {subtasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">Подзадач пока нет.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {subtasks.map((s) => (
            <li key={s.id}>
              <Link
                href={`/projects/${projectKey}/tasks/${s.number}`}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
              >
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {projectKey}-{s.number}
                </span>
                <span
                  className={
                    'flex-1 truncate ' +
                    (s.status === 'DONE' || s.status === 'CANCELED'
                      ? 'text-muted-foreground line-through'
                      : '')
                  }
                >
                  {s.title}
                </span>
                <TaskStatusBadge status={s.status} />
                {s.assignee ? (
                  <Avatar src={s.assignee.image} alt={s.assignee.name} className="h-5 w-5" />
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {canAdd ? (
        <AddSubtaskButton parentTaskId={parentTaskId} projectKey={projectKey} />
      ) : null}
    </div>
  );
}
