import Link from 'next/link';
import { Button } from '@giper/ui/components/Button';
import { Card, CardContent } from '@giper/ui/components/Card';
import { getActiveTimer } from '@/lib/time';
import { getT } from '@/lib/i18n';
import { LiveDuration } from '@/components/domain/LiveDuration';

export async function HeroSection({ userId }: { userId: string }) {
  const active = await getActiveTimer(userId);
  const t = await getT('dashboard.hero');

  if (!active?.task) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-4 py-6">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('running')}
            </div>
            <div className="mt-1 text-lg text-muted-foreground">{t('noTimer')}</div>
          </div>
          <Link href="/projects">
            <Button>{t('startTimer')}</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-4 py-6">
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {t('running')}
          </div>
          <Link
            href={`/projects/${active.task.project.key}/tasks/${active.task.number}`}
            className="mt-1 -mx-1 flex items-center gap-2 rounded px-1 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors duration-150"
          >
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {active.task.project.key}-{active.task.number}
            </span>
            <span className="truncate text-base font-medium">{active.task.title}</span>
          </Link>
        </div>
        <div className="flex items-center gap-4">
          {/* tabular-nums keeps the digits column-aligned as the timer
              ticks each second — without it the row jiggles. */}
          <span className="font-mono text-3xl font-semibold tabular-nums">
            <LiveDuration startedAt={active.startedAt} />
          </span>
          <Link href={`/projects/${active.task.project.key}/tasks/${active.task.number}`}>
            <Button variant="outline" size="sm">
              {t('openTask')}
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export function HeroSectionSkeleton() {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 py-6">
        <div className="flex flex-1 flex-col gap-2">
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-9 w-24 animate-pulse rounded bg-muted" />
      </CardContent>
    </Card>
  );
}
