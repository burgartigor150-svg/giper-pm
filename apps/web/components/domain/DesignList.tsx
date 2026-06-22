'use client';

import { useState, useTransition } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Figma, Trash2 } from 'lucide-react';
import { figmaEmbedUrl } from '@/lib/figma/parseFigmaUrl';
import {
  attachFigmaDesignAction,
  removeFigmaDesignAction,
  syncFigmaCommentsAction,
} from '@/actions/designs';

type Design = {
  id: string;
  url: string;
  title: string;
  nodeId: string | null;
  thumbnailUrl: string | null;
};

/**
 * Figma designs block on the task detail page. Lists linked designs, each with
 * a clickable link and an expandable live embed (Figma's official iframe — no
 * token needed for link-shared files). Editors can paste a URL to link a design
 * or remove one.
 */
export function DesignList({
  items,
  taskId,
  projectKey,
  taskNumber,
  canEdit,
}: {
  items: Design[];
  taskId: string;
  projectKey: string;
  taskNumber: number;
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  function add() {
    const v = url.trim();
    if (!v) return;
    startTransition(async () => {
      const res = await attachFigmaDesignAction(taskId, projectKey, taskNumber, v);
      if (res.ok) setUrl('');
      else alert(res.error.message);
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await removeFigmaDesignAction(id, projectKey, taskNumber);
      if (!res.ok) alert(res.error.message);
    });
  }

  function syncComments() {
    startTransition(async () => {
      const res = await syncFigmaCommentsAction(taskId, projectKey, taskNumber);
      if (res.ok) {
        alert(
          res.data && res.data.created > 0
            ? `Подтянуто комментариев: ${res.data.created}`
            : 'Новых комментариев Figma нет (или Figma не подключена).',
        );
      } else {
        alert(res.error.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Макеты Figma пока не привязаны.
          {canEdit ? ' Вставьте ссылку на файл/кадр Figma ниже.' : ''}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((d) => {
            const isOpen = !!open[d.id];
            return (
              <li key={d.id} className="rounded-md border p-2 text-sm">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen((s) => ({ ...s, [d.id]: !s[d.id] }))}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={isOpen ? 'Свернуть превью' : 'Показать превью'}
                  >
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <Figma className="h-4 w-4 shrink-0" style={{ color: '#a259ff' }} />
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 truncate font-medium hover:underline"
                    title={d.title}
                  >
                    {d.title}
                  </a>
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Открыть в Figma"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => remove(d.id)}
                      disabled={pending}
                      className="text-muted-foreground hover:text-red-600 disabled:opacity-50"
                      aria-label="Отвязать макет"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
                {isOpen ? (
                  <div className="mt-2 overflow-hidden rounded border">
                    <iframe
                      title={d.title}
                      src={figmaEmbedUrl(d.url)}
                      className="h-[420px] w-full"
                      allowFullScreen
                      loading="lazy"
                    />
                  </div>
                ) : d.thumbnailUrl ? (
                  // Collapsed: show the API thumbnail (if Figma is connected).
                  // Clicking expands to the live embed.
                  <button
                    type="button"
                    onClick={() => setOpen((s) => ({ ...s, [d.id]: true }))}
                    className="mt-2 block w-full overflow-hidden rounded border"
                    aria-label="Показать живое превью"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={d.thumbnailUrl}
                      alt={d.title}
                      loading="lazy"
                      className="max-h-56 w-full object-cover object-top"
                    />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {canEdit ? (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') add();
              }}
              placeholder="https://www.figma.com/design/…"
              className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-800"
            />
            <button
              type="button"
              onClick={add}
              disabled={pending || !url.trim()}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
            >
              Привязать
            </button>
          </div>
          {items.length > 0 ? (
            <button
              type="button"
              onClick={syncComments}
              disabled={pending}
              className="self-start text-xs text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
            >
              Подтянуть комментарии из Figma
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
