import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { resolveMyCrmAccess } from '@/lib/crm';
import { getEffectiveCaps, type EffectiveCaps } from '@/lib/capabilities';
import { getActiveTimerWithHealth } from '@/lib/time';
import { AppShell } from '@/components/domain/AppShell';
import { PushOptInBanner } from '@/components/domain/PushOptIn';
import { ActiveCallProvider } from '@/components/domain/ActiveCallProvider';
import { ActiveCallContainer } from '@/components/domain/ActiveCallContainer';
import { NewCalendarEventDialog } from '@/components/domain/calendar/NewCalendarEventDialog';
import type { NavItem } from '@/components/domain/Sidebar';

function buildNav(caps: EffectiveCaps, crmCanSee: boolean): NavItem[] {
  const items: NavItem[] = [
    { key: 'dashboard', href: '/dashboard' },
    { key: 'me', href: '/me' },
    { key: 'projects', href: '/projects' },
    { key: 'calendar', href: '/calendar' },
    { key: 'time', href: '/time' },
    { key: 'messages', href: '/messages' },
    // "Созвоны" — list page itself is filtered to runs the user
    // participated in / created, so it's safe for any role.
    { key: 'meetings', href: '/meetings' },
    // База знаний — org-wide, readable by any authenticated user.
    { key: 'knowledge', href: '/knowledge' },
  ];
  // Section visibility via effective capabilities (custom-role overlay; for an
  // unassigned user caps === the UserRole baseline, so this is identical to the
  // old role checks). CRM keeps its own scope resolution (crmAccess flag).
  if (caps.has('integrations.telegram.view')) items.push({ key: 'telegram', href: '/integrations/telegram' });
  if (caps.has('team.view')) items.push({ key: 'team', href: '/team' });
  if (caps.has('reports.view')) items.push({ key: 'reports', href: '/reports' });
  if (crmCanSee) items.push({ key: 'crm', href: '/crm' });
  if (caps.has('servicedesk.viewQueue')) items.push({ key: 'servicedesk', href: '/servicedesk' });
  if (caps.has('settings.view')) items.push({ key: 'settings', href: '/settings' });
  return items;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sessionUser = await requireAuth();

  // Force users with a fresh/temporary password to rotate it before they can do anything.
  if (sessionUser.mustChangePassword) {
    const path = (await headers()).get('x-pathname') ?? '';
    if (!path.startsWith('/me/security')) redirect('/me/security');
  }

  const [{ timer: activeTimer, health: timerHealth }, inboxUnread, caps, crmAccess] = await Promise.all([
    getActiveTimerWithHealth(sessionUser.id),
    prisma.notification.count({
      where: { userId: sessionUser.id, isRead: false },
    }),
    getEffectiveCaps({ id: sessionUser.id, role: sessionUser.role }),
    resolveMyCrmAccess({ id: sessionUser.id, role: sessionUser.role }),
  ]);
  const navItems = buildNav(caps, crmAccess.canSee);

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
      <ActiveCallProvider>
        <PushOptInBanner />
        {children}
        {/* Floating PiP — invisible when no call is active. Stays
            mounted across navigation so the WebRTC connection
            survives router pushes. */}
        <ActiveCallContainer />
        {/* Quick-create modal for calendar entries — listens for
            window 'giper:new-calendar-entry' so any view (calendar
            grid, day popover, etc.) can summon it. */}
        <NewCalendarEventDialog />
      </ActiveCallProvider>
    </AppShell>
  );
}
