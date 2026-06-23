'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight, History, RotateCcw } from 'lucide-react';
import { renderMarkdown } from '@/lib/knowledge/renderMarkdown';
import { restoreArticleVersionAction } from '@/actions/knowledge';

type Version = { id: string; title: string; content: string; editorName: string | null; createdAt: string };

/** Version history list with inline preview + restore (TEAMLY «Предыдущие версии»). */
export function KbVersionHistory({
  articleId,
  versions,
  canEdit,
}: {
  articleId: string;
  versions: Version[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);

  function restore(versionId: string) {
    if (!confirm('Восстановить эту версию? Текущее состояние сохранится в истории.')) return;
    startTransition(async () => {
      const res = await restoreArticleVersionAction(versionId);
      if (res.ok) router.push(`/knowledge/${articleId}`);
      else alert(res.error.message);
    });
  }

  if (versions.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-muted-foreground dark:border-neutral-700">
        У статьи пока нет истории изменений.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {versions.map((v) => {
        const open = openId === v.id;
        return (
          <li key={v.id} className="rounded-lg border border-neutral-200 dark:border-neutral-800">
            <div className="flex items-center gap-2 px-3 py-2">
              <button
                type="button"
                onClick={() => setOpenId(open ? null : v.id)}
                className="text-muted-foreground"
                aria-label={open ? 'Свернуть' : 'Развернуть'}
              >
                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              <History className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{v.title}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(v.createdAt).toLocaleString('ru-RU')}
                  {v.editorName ? ` · ${v.editorName}` : ''}
                </p>
              </div>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => restore(v.id)}
                  disabled={pending}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-muted disabled:opacity-50 dark:border-neutral-700"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Восстановить
                </button>
              ) : null}
            </div>
            {open ? (
              <div className="max-w-none break-words border-t border-neutral-200 p-3 text-sm dark:border-neutral-800">
                {v.content.trim() ? renderMarkdown(v.content) : <p className="text-muted-foreground">Пусто.</p>}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
