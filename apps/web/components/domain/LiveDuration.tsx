'use client';

import { useEffect, useState } from 'react';

type Props = {
  /** Start of the running interval (any Date-parsable value). */
  startedAt: Date | string;
  className?: string;
};

/**
 * Renders an HH:MM:SS counter ticking once per second.
 * Pure compute, no fetch — client just diffs Date.now() against startedAt.
 */
export function LiveDuration({ startedAt, className }: Props) {
  const start = typeof startedAt === 'string' ? new Date(startedAt) : startedAt;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const sec = Math.max(0, Math.floor((now - start.getTime()) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const text =
    h > 0
      ? `${h}:${pad(m)}:${pad(s)}`
      : `${pad(m)}:${pad(s)}`;

  return (
    <span className={className} aria-label="Время">
      {text}
    </span>
  );
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
