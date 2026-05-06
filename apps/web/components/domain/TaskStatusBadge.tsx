import { useTranslations } from 'next-intl';
import { cn } from '@giper/ui/cn';

type Status = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'BLOCKED' | 'DONE' | 'CANCELED';

const COLORS: Record<Status, string> = {
  BACKLOG: 'bg-neutral-200 text-neutral-700',
  TODO: 'bg-sky-100 text-sky-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  REVIEW: 'bg-amber-100 text-amber-700',
  BLOCKED: 'bg-red-100 text-red-700',
  DONE: 'bg-green-100 text-green-700',
  CANCELED: 'bg-neutral-200 text-neutral-500 line-through',
};

export function TaskStatusBadge({ status }: { status: Status }) {
  const t = useTranslations('tasks.status');
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        COLORS[status],
      )}
    >
      {t(status)}
    </span>
  );
}
