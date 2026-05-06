'use client';

import { Menu, Plus, Search } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import { Input } from '@giper/ui/components/Input';
import { useT } from '@/lib/useT';
import { TimerWidget } from './TimerWidget';
import { UserMenu } from './UserMenu';

type ActiveTimer = {
  startedAt: Date | string;
  task: {
    id: string;
    number: number;
    title: string;
    project: { key: string };
  } | null;
};

type Props = {
  user: {
    name: string;
    email?: string | null;
    image?: string | null;
  };
  onOpenMenu: () => void;
  activeTimer: ActiveTimer | null;
};

export function Topbar({ user, onOpenMenu, activeTimer }: Props) {
  const t = useT('topbar');

  return (
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

      <div className="relative hidden flex-1 sm:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder={t('searchPlaceholder')}
          disabled
          className="pl-9"
          aria-label={t('searchPlaceholder')}
        />
      </div>

      <div className="relative ml-auto flex items-center gap-2">
        <TimerWidget active={activeTimer} />
        <Button variant="default" size="sm" disabled aria-label={t('createTask')}>
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">{t('createTask')}</span>
        </Button>
        <UserMenu name={user.name} email={user.email} image={user.image} />
      </div>
    </header>
  );
}
