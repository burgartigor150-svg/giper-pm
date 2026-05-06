import { useTranslations } from 'next-intl';
import { cn } from '@giper/ui/cn';

type Status = 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'ARCHIVED';

const COLORS: Record<Status, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  ON_HOLD: 'bg-amber-100 text-amber-700',
  COMPLETED: 'bg-sky-100 text-sky-700',
  ARCHIVED: 'bg-neutral-200 text-neutral-700',
};

export function StatusBadge({ status }: { status: Status }) {
  const t = useTranslations('projects.status');
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
