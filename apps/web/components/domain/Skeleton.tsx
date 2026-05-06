import { cn } from '@giper/ui/cn';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className={cn('animate-pulse rounded-md bg-muted', className)}
    />
  );
}
