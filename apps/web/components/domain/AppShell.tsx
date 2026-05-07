'use client';

import { useCallback, useState } from 'react';
import { RealtimeProvider } from '@giper/realtime/client';
import { Sidebar, type NavItem } from './Sidebar';
import { Topbar } from './Topbar';
import { CommandPalette } from './CommandPalette';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { QuickAddDialog } from './QuickAddDialog';
import { getWsTokenAction } from '@/actions/notifications';

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
  navItems: NavItem[];
  activeTimer: ActiveTimer | null;
  timerHealth?: TimerHealth;
  /** WS server URL (e.g. wss://giper.example.com/ws). Empty = realtime disabled. */
  wsUrl?: string | null;
  /** Initial unread notifications count for the InboxBell SSR render. */
  inboxUnread?: number;
  children: React.ReactNode;
};

export function AppShell({
  user,
  navItems,
  activeTimer,
  timerHealth = 'OK',
  wsUrl,
  inboxUnread = 0,
  children,
}: Props) {
  const [open, setOpen] = useState(false);

  // The realtime provider needs a callable for fresh tokens. We pass
  // the server action directly; React 19 server actions are awaitable
  // from the client, no extra fetch wrapper needed.
  const getToken = useCallback(async () => {
    const { token } = await getWsTokenAction();
    return token;
  }, []);

  // Skip the provider entirely if the WS URL isn't configured — saves
  // an opening WebSocket on every render in dev environments without
  // the realtime stack.
  const tree = (
    <div className="flex min-h-screen bg-muted/30">
      <Sidebar items={navItems} open={open} onClose={() => setOpen(false)} />
      {/* min-w-0 is the standard flex-shrink unlock so the main column
          can collapse below its intrinsic content width when a child has
          a long unbroken token. Without it, the whole layout would scroll
          horizontally (and clip the sidebar's contents on desktop). */}
      <div className="flex min-h-screen w-full min-w-0 flex-col">
        <Topbar
          user={user}
          onOpenMenu={() => setOpen(true)}
          activeTimer={activeTimer}
          timerHealth={timerHealth}
          inboxUnread={inboxUnread}
        />
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
      <CommandPalette />
      <KeyboardShortcuts />
      <QuickAddDialog />
    </div>
  );

  if (!wsUrl) return tree;
  return (
    <RealtimeProvider url={wsUrl} getToken={getToken}>
      {tree}
    </RealtimeProvider>
  );
}
