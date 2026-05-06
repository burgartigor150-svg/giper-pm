import { useTranslations } from 'next-intl';
import { cn } from '@giper/ui/cn';

type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

const COLORS: Record<Priority, string> = {
  LOW: 'text-neutral-500',
  MEDIUM: 'text-neutral-700',
  HIGH: 'text-amber-700',
  URGENT: 'text-red-700 font-semibold',
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  const t = useTranslations('tasks.priority');
  return <span className={cn('text-xs', COLORS[priority])}>{t(priority)}</span>;
}
