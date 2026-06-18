'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FilePlus2, ChevronDown } from 'lucide-react';
import { createTaskFromTemplateAction } from '@/actions/cardTemplates';

type Template = { id: string; name: string };

type Props = {
  projectKey: string;
  templates: Template[];
};

/**
 * "Create from template" dropdown for the board header. Picking a template
 * creates the task server-side and navigates straight to the new card.
 * Renders nothing when the project has no templates.
 */
export function TemplatePicker({ projectKey, templates }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  if (templates.length === 0) return null;

  function pick(templateId: string) {
    setOpen(false);
    setError(null);
    startTransition(async () => {
      const res = await createTaskFromTemplateAction(projectKey, templateId);
      if (res.ok && res.data) {
        router.push(`/projects/${projectKey}/tasks/${res.data.number}`);
      } else if (!res.ok) {
        setError(res.error.message);
      }
    });
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
      >
        <FilePlus2 className="h-4 w-4" />
        {pending ? 'Создаю…' : 'Из шаблона'}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      {open ? (
        <>
          {/* click-away backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-20 mt-1 max-h-72 w-56 overflow-auto rounded-md border bg-background p-1 shadow-lg">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => pick(t.id)}
                className="block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                {t.name}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {error ? (
        <p className="absolute right-0 mt-1 whitespace-nowrap text-xs text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
