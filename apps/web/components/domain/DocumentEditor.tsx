'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Trash2 } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import { updateDocumentAction, deleteDocumentAction } from '@/actions/documents';

type Props = {
  docId: string;
  projectKey: string;
  initialTitle: string;
  initialContent: string;
  canEdit: boolean;
};

/**
 * Wiki-style document editor: title + Markdown content. Editors get an
 * always-on edit surface (save persists); non-editors see read-only fields.
 */
export function DocumentEditor({
  docId,
  projectKey,
  initialTitle,
  initialContent,
  canEdit,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = title !== initialTitle || content !== initialContent;

  function save() {
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const res = await updateDocumentAction(docId, title, content);
      if (res.ok) {
        setSaved(true);
        router.refresh();
        setTimeout(() => setSaved(false), 1500);
      } else {
        setError(res.error.message);
      }
    });
  }

  function remove() {
    if (!confirm('Удалить документ и все вложенные?')) return;
    startTransition(async () => {
      await deleteDocumentAction(docId);
    });
  }

  return (
    <div className="mx-auto max-w-[900px] space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/projects/${projectKey}/docs`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Документы
        </Link>
        {canEdit ? (
          <div className="flex items-center gap-2">
            {saved ? <span className="text-xs text-emerald-600">Сохранено</span> : null}
            {error ? <span className="text-xs text-destructive">{error}</span> : null}
            <Button type="button" size="sm" onClick={save} disabled={pending || !dirty}>
              {pending ? 'Сохраняю…' : 'Сохранить'}
            </Button>
            <button
              type="button"
              aria-label="Удалить документ"
              onClick={remove}
              disabled={pending}
              className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={!canEdit || pending}
        maxLength={200}
        placeholder="Заголовок"
        className="w-full border-0 bg-transparent text-2xl font-semibold outline-none disabled:opacity-100"
      />

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        disabled={!canEdit || pending}
        placeholder="Текст документа (Markdown)…"
        className="min-h-[60vh] w-full resize-y rounded-md border border-input bg-background p-3 font-mono text-sm leading-relaxed outline-none focus:ring-1 focus:ring-ring disabled:opacity-100"
      />
    </div>
  );
}
