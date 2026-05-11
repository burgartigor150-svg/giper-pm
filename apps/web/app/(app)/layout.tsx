import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { canSeeReports, canSeeSettings, type SessionUser } from '@/lib/permissions';
import { getActiveTimerWithHealth } from '@/lib/time';
import { AppShell } from '@/components/domain/AppShell';
import { PushOptInBanner } from '@/components/domain/PushOptIn';
import type { NavItem } from '@/components/domain/Sidebar';

function buildNav(user: SessionUser): NavItem[] {
  const items: NavItem[] = [
    { key: 'dashboard', href: '/dashboard' },
    { key: 'me', href: '/me' },
    { key: 'projects', href: '/projects' },
    { key: 'calendar', href: '/calendar' },
    { key: 'time', href: '/time' },
    { key: 'messages', href: '/messages' },
  ];
  if (canSeeSettings(user)) {
    items.push({ key: 'telegram', href: '/integrations/telegram' });
    items.push({ key: 'meetings', href: '/meetings' });
  }
  if (user.role === 'ADMIN' || user.role === 'PM') {
    items.push({ key: 'team', href: '/team' });
  }
  if (canSeeReports(user)) items.push({ key: 'reports', href: '/reports' });
  if (canSeeSettings(user)) items.push({ key: 'settings', href: '/settings' });
  return items;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sessionUser = await requireAuth();

  // Force users with a fresh/temporary password to rotate it before they can do anything.
  if (sessionUser.mustChangePassword) {
    const path = (await headers()).get('x-pathname') ?? '';
    if (!path.startsWith('/me/security')) redirect('/me/security');
  }

  const navItems = buildNav({ id: sessionUser.id, role: sessionUser.role });
  const [{ timer: activeTimer, health: timerHealth }, inboxUnread] = await Promise.all([
    getActiveTimerWithHealth(sessionUser.id),
    prisma.notification.count({
      where: { userId: sessionUser.id, isRead: false },
    }),
  ]);

  return (
    <AppShell
      user={{
        id: sessionUser.id,
        name: sessionUser.name ?? sessionUser.email ?? '',
        email: sessionUser.email,
        image: sessionUser.image,
      }}
      navItems={navItems}
      activeTimer={activeTimer}
      timerHealth={timerHealth}
      wsUrl={process.env.NEXT_PUBLIC_WS_URL ?? null}
      inboxUnread={inboxUnread}
    >
      <PushOptInBanner />
      {children}
    </AppShell>
  );
}
