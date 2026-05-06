'use client';

import { useEffect, useRef, useState } from 'react';
import { LogOut, ChevronDown } from 'lucide-react';
import { Avatar } from '@giper/ui/components/Avatar';
import { cn } from '@giper/ui/cn';
import { useT } from '@/lib/useT';
import { signOutAction } from '@/actions/auth';

type Props = {
  name: string;
  email?: string | null;
  image?: string | null;
};

export function UserMenu({ name, email, image }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const t = useT('topbar.userMenu');

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
          'hover:bg-accent hover:text-accent-foreground',
        )}
      >
        <Avatar src={image} alt={name} className="h-7 w-7" />
        <span className="hidden text-muted-foreground sm:inline">{name}</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 w-56 overflow-hidden rounded-md border border-border bg-background shadow-md"
        >
          <div className="border-b border-border px-3 py-2">
            <div className="text-sm font-medium">{name}</div>
            {email ? (
              <div className="truncate text-xs text-muted-foreground">{email}</div>
            ) : null}
          </div>
          <form action={signOutAction}>
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            >
              <LogOut className="h-4 w-4" />
              {t('signOut')}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
