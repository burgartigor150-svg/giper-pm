'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, FileText, LayoutTemplate } from 'lucide-react';
import { createArticleFromTemplateAction } from '@/actions/knowledge';

type Template = {
  id: string;
  name: string;
  icon: string | null;
  description: string | null;
  scope: 'ACCOUNT' | 'SPACE';
};

/**
 * "New article from template" dropdown for the space page. Lists the templates
 * applicable to this space (account-wide + space-scoped); picking one creates
 * a pre-filled article and navigates to it.
 */
export function KbNewFromTemplate({ spaceId, templates }: { spaceId: string; templates: Template[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (templates.length === 0) return null;

  function pick(templateId: string) {
    setOpen(false);
    startTransition(async () => {
      const res = await createArticleFromTemplateAction(spaceId, null, templateId);
      if (res.ok && res.data) router.push(`/knowledge/${res.data.id}`);
      else if (!res.ok) alert(res.error.message);
    });
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1.5 text-xs disabled:opacity-50 dark:border-neutral-700"
      >
        <LayoutTemplate className="h-3.5 w-3.5" /> Из шаблона <ChevronDown className="h-3 w-3" />
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-1 max-h-72 w-64 overflow-y-auto rounded-lg border border-neutral-200 bg-background p-1 shadow-lg dark:border-neutral-700">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => pick(t.id)}
              className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              <span className="shrink-0 pt-0.5">{t.icon ?? <FileText className="h-4 w-4 text-muted-foreground" />}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{t.name}</span>
                {t.description ? <span className="block truncate text-xs text-muted-foreground">{t.description}</span> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
