'use client';

import { useState } from 'react';
import { Sidebar, type NavItem } from './Sidebar';
import { Topbar } from './Topbar';

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
  navItems: NavItem[];
  activeTimer: ActiveTimer | null;
  children: React.ReactNode;
};

export function AppShell({ user, navItems, activeTimer, children }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-muted/30">
      <Sidebar items={navItems} open={open} onClose={() => setOpen(false)} />
      <div className="flex min-h-screen w-full flex-col md:pl-0">
        <Topbar
          user={user}
          onOpenMenu={() => setOpen(true)}
          activeTimer={activeTimer}
        />
        <main className="flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
