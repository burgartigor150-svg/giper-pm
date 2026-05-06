import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireAuth } from '@/lib/auth';
import { canSeeReports, canSeeSettings, type SessionUser } from '@/lib/permissions';
import { AppShell } from '@/components/domain/AppShell';
import type { NavItem } from '@/components/domain/Sidebar';

function buildNav(user: SessionUser): NavItem[] {
  const items: NavItem[] = [
    { key: 'dashboard', href: '/dashboard' },
    { key: 'projects', href: '/projects' },
    { key: 'time', href: '/time' },
  ];
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

  return (
    <AppShell
      user={{
        name: sessionUser.name ?? sessionUser.email ?? '',
        email: sessionUser.email,
        image: sessionUser.image,
      }}
      navItems={navItems}
    >
      {children}
    </AppShell>
  );
}
