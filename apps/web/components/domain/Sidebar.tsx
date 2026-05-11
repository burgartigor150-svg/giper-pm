'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FolderKanban,
  Clock,
  BarChart3,
  Settings,
  Users,
  User,
  MessageSquare,
  Calendar,
  Send,
  Video,
  X,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react';
import { cn } from '@giper/ui/cn';
import { Button } from '@giper/ui/components/Button';
import { useT } from '@/lib/useT';

const COLLAPSED_KEY = 'giper-pm.sidebar.collapsed';

export type NavKey =
  | 'dashboard'
  | 'me'
  | 'projects'
  | 'time'
  | 'calendar'
  | 'team'
  | 'messages'
  | 'telegram'
  | 'meetings'
  | 'reports'
  | 'settings';

export type NavItem = {
  key: NavKey;
  href: string;
};

const ICONS: Record<NavKey, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  me: User,
  projects: FolderKanban,
  time: Clock,
  calendar: Calendar,
  team: Users,
  messages: MessageSquare,
  telegram: Send,
  meetings: Video,
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
  // Desktop-only collapse to an icons-only rail. Persisted in
  // localStorage as a UI preference (not business data).
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === '1');
    } catch {
      /* SSR/privacy mode — leave default */
    }
  }, []);
  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }

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
          'fixed inset-y-0 left-0 z-40 flex flex-col border-r border-border bg-background transition-[width,transform] duration-200',
          // Mobile drawer is always full width (60); only desktop
          // honours the collapsed state.
          'w-60',
          'md:static md:translate-x-0',
          collapsed ? 'md:w-14' : 'md:w-60',
          open ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        )}
        aria-label="Sidebar"
      >
        <div
          className={cn(
            'flex h-14 shrink-0 items-center border-b border-border',
            collapsed ? 'md:justify-center md:px-2' : 'px-4',
            'justify-between',
          )}
        >
          {!collapsed ? (
            <Link href="/dashboard" className="text-sm font-semibold tracking-tight">
              giper-pm
            </Link>
          ) : (
            <Link
              href="/dashboard"
              className="hidden text-sm font-semibold tracking-tight md:block"
              title="giper-pm"
            >
              g
            </Link>
          )}
          {/* Desktop collapse toggle. Hidden on mobile where the X
              close button takes the same slot. */}
          <Button
            variant="ghost"
            size="icon"
            className="hidden md:inline-flex"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
            title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
          >
            {collapsed ? (
              <PanelLeft className="h-5 w-5" />
            ) : (
              <PanelLeftClose className="h-5 w-5" />
            )}
          </Button>
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
              const label = t(item.key);
              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    onClick={onClose}
                    title={collapsed ? label : undefined}
                    className={cn(
                      'flex items-center rounded-md text-sm transition-colors',
                      collapsed
                        ? 'md:justify-center md:px-2 md:py-2 gap-3 px-3 py-2'
                        : 'gap-3 px-3 py-2',
                      isActive
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className={cn(collapsed ? 'md:hidden' : '')}>{label}</span>
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
