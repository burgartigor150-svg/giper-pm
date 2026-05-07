'use client';

import { Menu, Plus, Search } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import { useT } from '@/lib/useT';
import { TimerWidget } from './TimerWidget';
import { UserMenu } from './UserMenu';
import { InboxBell } from './InboxBell';

function openPalette() {
  window.dispatchEvent(new CustomEvent('giper:open-palette'));
}
function quickAddTask() {
  window.dispatchEvent(new CustomEvent('giper:quick-add-task'));
}

type ActiveTimer = {
  startedAt: Date | string;
  task: {
    id: string;
    number: number;
    title: string;
    project: { key: string };
  } | null;
};

type TimerHealth = 'OK' | 'WARN' | 'AUTO_STOPPED';

type Props = {
  user: {
    id: string;
    name: string;
    email?: string | null;
    image?: string | null;
  };
  onOpenMenu: () => void;
  activeTimer: ActiveTimer | null;
  timerHealth?: TimerHealth;
  inboxUnread?: number;
};

export function Topbar({
  user,
  onOpenMenu,
  activeTimer,
  timerHealth = 'OK',
  inboxUnread = 0,
}: Props) {
  const t = useT('topbar');

  return (
    <>
      {timerHealth === 'WARN' ? <TimerWarnBanner /> : null}
      {timerHealth === 'AUTO_STOPPED' ? <AutoStoppedBanner /> : null}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background px-4 md:px-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenMenu}
          aria-label={t('openMenu')}
          className="md:hidden"
        >
          <Menu className="h-5 w-5" />
        </Button>

        <button
          type="button"
          onClick={openPalette}
          aria-label="Открыть командное меню"
          className="hidden h-9 flex-1 items-center gap-2 rounded-md border border-input bg-background px-3 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground sm:flex"
        >
          <Search className="h-4 w-4" />
          <span className="flex-1 truncate">Найти или перейти…</span>
          <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
        </button>

        <div className="relative ml-auto flex items-center gap-2">
          <TimerWidget active={activeTimer} />
          <Button
            variant="default"
            size="sm"
            onClick={quickAddTask}
            aria-label={t('createTask')}
            title="Новая задача (C)"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{t('createTask')}</span>
          </Button>
          <InboxBell userId={user.id} initialUnread={inboxUnread} />
          <UserMenu name={user.name} email={user.email} image={user.image} />
        </div>
      </header>
    </>
  );
}

/**
 * Soft warning shown above the topbar when the active timer has been
 * running long enough to suggest the user might have forgotten about it
 * (default 4h, env-configurable). Click anywhere stops the timer via the
 * shared `giper:toggle-timer` event.
 */
function TimerWarnBanner() {
  return (
    <div className="bg-amber-50 px-4 py-2 text-center text-xs text-amber-900 md:px-6">
      Таймер идёт уже более {process.env.NEXT_PUBLIC_TIMER_SOFT_WARN_HOURS ?? 4} ч.{' '}
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent('giper:toggle-timer'))}
        className="font-medium underline underline-offset-2 hover:text-amber-700"
      >
        Остановить
      </button>
      {' '}или продолжить — не забудьте про обед.
    </div>
  );
}

/**
 * Hard stop notification — the timer was just auto-closed. Stays visible
 * until the user navigates (covered on next render after they handle it
 * on /me, where the day timeline shows the AUTO_STOPPED entry with a
 * keep/trim/delete affordance).
 */
function AutoStoppedBanner() {
  return (
    <div className="bg-red-50 px-4 py-2 text-center text-xs text-red-900 md:px-6">
      Таймер был автоматически остановлен (превышен лимит).{' '}
      <a href="/me" className="font-medium underline underline-offset-2 hover:text-red-700">
        Открыть «Мой день»
      </a>
      , чтобы решить судьбу записи.
    </div>
  );
}
