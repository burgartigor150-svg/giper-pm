'use client';

import { useEffect, useState } from 'react';

type Props = {
  /** Start of the running interval (any Date-parsable value). */
  startedAt: Date | string;
  className?: string;
};

/**
 * Renders an HH:MM:SS counter ticking once per second.
 *
 * Hydration: the server can't know the same `Date.now()` the browser will
 * pick a moment later, so SSR + a `useState(Date.now())` initializer would
 * always mismatch. We render a stable placeholder (computed from startedAt
 * + 0 elapsed) until after the first client effect, then switch on the live
 * tick. The server payload and the first client paint then agree.
 */
export function LiveDuration({ startedAt, className }: Props) {
  const start = typeof startedAt === 'string' ? new Date(startedAt) : startedAt;
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // First server + first client render: 0:00 (consistent payload).
  const elapsedMs = now === null ? 0 : Math.max(0, now - start.getTime());
  const sec = Math.floor(elapsedMs / 1000);
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
