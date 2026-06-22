'use client';

import { useEffect, useState } from 'react';
import type { KbHeading } from '@/lib/knowledge/renderMarkdown';

/**
 * Auto table of contents from an article's headings. Sticky right rail;
 * highlights the heading currently in view via IntersectionObserver (no
 * scroll-handler churn). Clicking scrolls to the anchored heading.
 */
export function KbToc({ headings }: { headings: KbHeading[] }) {
  const [active, setActive] = useState<string | null>(headings[0]?.slug ?? null);

  useEffect(() => {
    if (headings.length === 0) return;
    const els = headings
      .map((h) => document.getElementById(h.slug))
      .filter((el): el is HTMLElement => !!el);
    if (els.length === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActive(visible[0].target.id);
      },
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [headings]);

  if (headings.length < 2) return null;

  return (
    <nav className="sticky top-6 hidden max-h-[calc(100vh-6rem)] w-56 shrink-0 overflow-y-auto border-l border-neutral-200 pl-4 text-sm xl:block dark:border-neutral-800">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Содержание
      </p>
      <ul className="space-y-1">
        {headings.map((h) => (
          <li key={h.slug} style={{ paddingLeft: `${(Math.min(h.level, 4) - 1) * 10}px` }}>
            <a
              href={`#${h.slug}`}
              className={`block truncate transition-colors hover:text-foreground ${
                active === h.slug ? 'font-medium text-foreground' : 'text-muted-foreground'
              }`}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
