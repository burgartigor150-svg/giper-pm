import { useTranslations } from 'next-intl';
import { ArrowDown, Minus, ArrowUp, AlertTriangle } from 'lucide-react';
import { cn } from '@giper/ui/cn';

type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

/**
 * Priority badge per design-system/giper-pm/MASTER.md §1 priority table.
 *
 * Color is paired with a directional Lucide icon so the signal survives
 * color-blindness and screen readers (MASTER §10/§11: never convey
 * priority by color alone). MEDIUM is rendered as a faint dash — it's
 * the default and shouldn't compete visually with HIGH/URGENT.
 */
const PRIORITY: Record<
  Priority,
  { className: string; Icon: typeof ArrowDown }
> = {
  LOW: {
    className: 'text-muted-foreground',
    Icon: ArrowDown,
  },
  MEDIUM: {
    className: 'text-muted-foreground',
    Icon: Minus,
  },
  HIGH: {
    // amber-600 (#D97706) — MASTER §1, WCAG AA on white
    className: 'text-amber-600 dark:text-amber-500',
    Icon: ArrowUp,
  },
  URGENT: {
    className: 'text-destructive font-semibold',
    Icon: AlertTriangle,
  },
};

export function PriorityBadge({
  priority,
  iconOnly = false,
}: {
  priority: Priority;
  /** When true (e.g. tight calendar cells) render just the icon with
   *  the label moved to `aria-label`. Default false. */
  iconOnly?: boolean;
}) {
  const t = useTranslations('tasks.priority');
  const { className, Icon } = PRIORITY[priority];
  const label = t(priority);
  if (iconOnly) {
    return (
      <span className={cn('inline-flex items-center', className)} aria-label={label} title={label}>
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', className)}>
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {label}
    </span>
  );
}
