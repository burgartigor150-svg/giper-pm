import Link from 'next/link';
import { Avatar } from '@giper/ui/components/Avatar';
import { Button } from '@giper/ui/components/Button';
import { requireAuth } from '@/lib/auth';
import { signOutAction } from '@/actions/auth';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border bg-background px-6 py-3">
        <Link href="/dashboard" className="text-sm font-semibold tracking-tight">
          giper-pm
        </Link>
        <div className="flex items-center gap-3">
          <Avatar src={user.image} alt={user.name ?? user.email ?? '?'} />
          <span className="text-sm text-muted-foreground">{user.name ?? user.email}</span>
          <form action={signOutAction}>
            <Button type="submit" variant="outline" size="sm">
              Выйти
            </Button>
          </form>
        </div>
      </header>
      <main className="flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
