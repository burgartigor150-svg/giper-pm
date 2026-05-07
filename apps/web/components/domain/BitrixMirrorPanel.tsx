import { Avatar } from '@giper/ui/components/Avatar';
import { TaskStatusBadge } from './TaskStatusBadge';
import type { TaskStatus } from '@giper/db';

type Props = {
  /** Bitrix-mirrored status — what the client sees in Bitrix. */
  status: TaskStatus;
  /** Bitrix-mirrored assignee — also tracked through to Bitrix. */
  assignee: { id: string; name: string; image: string | null } | null;
};

/**
 * Read-only summary of the Bitrix-mirrored fields. Shown only on
 * tasks where externalSource === 'bitrix24'. The sister sidebar
 * below it is the editable internal track. The split makes the
 * two-track concept explicit so the team doesn't accidentally
 * try to "fix" the Bitrix status from our side.
 */
export function BitrixMirrorPanel({ status, assignee }: Props) {
  return (
    <div className="rounded-md border border-blue-200 bg-blue-50/50 p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-900">
        Из Bitrix24 (read-only)
      </div>
      <div className="flex flex-col gap-2 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs uppercase text-muted-foreground">Статус</span>
          <TaskStatusBadge status={status} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs uppercase text-muted-foreground">Исполнитель</span>
          {assignee ? (
            <span className="inline-flex items-center gap-1.5 text-xs">
              <Avatar src={assignee.image} alt={assignee.name} className="h-5 w-5" />
              {assignee.name}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Эти поля синхронизируются с Bitrix24 и редактируются там же.
          Внутренние статус и исполнители — ниже.
        </p>
      </div>
    </div>
  );
}
