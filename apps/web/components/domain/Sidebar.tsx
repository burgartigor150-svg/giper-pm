'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, FolderKanban, Clock, BarChart3, Settings, Users, X } from 'lucide-react';
import { cn } from '@giper/ui/cn';
import { Button } from '@giper/ui/components/Button';
import { useT } from '@/lib/useT';

export type NavKey =
  | 'dashboard'
  | 'projects'
  | 'time'
  | 'team'
  | 'reports'
  | 'settings';

export type NavItem = {
  key: NavKey;
  href: string;
};

const ICONS: Record<NavKey, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  projects: FolderKanban,
  time: Clock,
  team: Users,
  reports: BarChart3,
  settings: Settings,
};

type SidebarProps = {
  items: NavItem[];
  /** Controlled open state for mobile drawer. Desktop sidebar is always visible. */
  open: boolean;
  onClose: () => void;
};

export function Sidebar({ items, open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const t = useT('nav');

  return (
    <>
      {/* Mobile overlay */}
      <div
        className={cn(
          'fixed inset-0 z-30 bg-black/40 transition-opacity md:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        aria-hidden
      />

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-border bg-background transition-transform',
          'md:static md:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        )}
        aria-label="Sidebar"
      >
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          <Link href="/dashboard" className="text-sm font-semibold tracking-tight">
            giper-pm
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={onClose}
            aria-label="Закрыть меню"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          <ul className="flex flex-col gap-1">
            {items.map((item) => {
              const Icon = ICONS[item.key];
              const isActive =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    onClick={onClose}
                    className={cn(
                      'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{t(item.key)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>
    </>
  );
}
