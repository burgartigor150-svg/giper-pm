import * as React from 'react';
import { cn } from '../lib/cn';

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  src?: string | null;
  alt?: string;
  fallback?: string;
}

export function Avatar({ src, alt, fallback, className, ...props }: AvatarProps) {
  const initials = (fallback ?? alt ?? '?').slice(0, 2).toUpperCase();
  return (
    <span
      className={cn(
        'relative inline-flex h-9 w-9 shrink-0 overflow-hidden rounded-full bg-muted text-muted-foreground',
        className,
      )}
      {...props}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt ?? ''} className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-xs font-medium">
          {initials}
        </span>
      )}
    </span>
  );
}
