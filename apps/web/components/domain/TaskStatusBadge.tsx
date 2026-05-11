import { useTranslations } from 'next-intl';
import {
  Circle,
  CircleDashed,
  CircleDot,
  Eye,
  Ban,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { cn } from '@giper/ui/cn';

type Status = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'BLOCKED' | 'DONE' | 'CANCELED';

/**
 * Status badge per design-system/giper-pm/MASTER.md §1 status table.
 *
 * Two non-negotiable rules from MASTER:
 *   §1 — exact palette per status (HSL tokens compiled to bg-* utilities)
 *   §10/§11 — status MUST NOT be conveyed by color alone; every chip
 *             pairs the label with a Lucide icon, so colorblind users
 *             and screen readers don't lose meaning.
 *
 * Radius is `rounded-sm` (chip) per MASTER §5 — pill style (rounded-full)
 * is reserved for avatar groups and filter chips.
 */
const STATUS: Record<
  Status,
  { className: string; Icon: typeof Circle }
> = {
  BACKLOG: {
    className: 'bg-muted text-muted-foreground',
    Icon: CircleDashed,
  },
  TODO: {
    className: 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300',
    Icon: Circle,
  },
  IN_PROGRESS: {
    className: 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
    Icon: CircleDot,
  },
  REVIEW: {
    className: 'bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300',
    Icon: Eye,
  },
  BLOCKED: {
    className: 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300',
    Icon: Ban,
  },
  DONE: {
    className: 'bg-green-50 text-green-800 dark:bg-green-950/50 dark:text-green-300',
    Icon: CheckCircle2,
  },
  CANCELED: {
    className: 'bg-muted text-muted-foreground line-through',
    Icon: XCircle,
  },
};

export function TaskStatusBadge({ status }: { status: Status }) {
  const t = useTranslations('tasks.status');
  const { className, Icon } = STATUS[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium',
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {t(status)}
    </span>
  );
}
