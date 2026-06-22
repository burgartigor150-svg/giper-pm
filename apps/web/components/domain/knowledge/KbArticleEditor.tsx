'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import { renderMarkdown } from '@/lib/knowledge/renderMarkdown';
import {
  updateArticleAction,
  deleteArticleAction,
  createArticleAction,
} from '@/actions/knowledge';

/**
 * Knowledge Base article view/editor. Editors get an editable title + a
 * Markdown body with a Просмотр/Редактор toggle (rendered via renderRichText);
 * viewers see read-only rendered content. Plus delete + add-subarticle.
 */
export function KbArticleEditor({
  id,
  spaceId,
  initialTitle,
  initialContent,
  canEdit,
}: {
  id: string;
  spaceId: string;
  initialTitle: string;
  initialContent: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [mode, setMode] = useState<'view' | 'edit'>(
    !initialContent.trim() && canEdit ? 'edit' : 'view',
  );
  const [saved, setSaved] = useState(false);

  const dirty = title !== initialTitle || content !== initialContent;

  function save() {
    startTransition(async () => {
      const res = await updateArticleAction(id, { title, content });
      if (res.ok) {
        setSaved(true);
        router.refresh();
        setTimeout(() => setSaved(false), 1500);
      } else {
        alert(res.error.message);
      }
    });
  }

  function remove() {
    if (!confirm('Удалить статью и все подстатьи?')) return;
    startTransition(async () => {
      const res = await deleteArticleAction(id);
      if (res.ok) router.push('/knowledge');
      else alert(res.error.message);
    });
  }

  function addChild() {
    startTransition(async () => {
      const res = await createArticleAction(spaceId, id);
      if (res.ok && res.data) router.push(`/knowledge/${res.data.id}`);
      else if (!res.ok) alert(res.error.message);
    });
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex items-start gap-3">
        {canEdit ? (
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Заголовок статьи"
            className="min-w-0 flex-1 border-0 bg-transparent text-2xl font-bold outline-none placeholder:text-muted-foreground"
          />
        ) : (
          <h1 className="min-w-0 flex-1 text-2xl font-bold">{title}</h1>
        )}
        {canEdit ? (
          <div className="flex shrink-0 items-center gap-1.5 pt-2">
            <button
              type="button"
              onClick={() => setMode((m) => (m === 'edit' ? 'view' : 'edit'))}
              className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
            >
              {mode === 'edit' ? <Eye className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
              {mode === 'edit' ? 'Просмотр' : 'Редактор'}
            </button>
            <button
              type="button"
              onClick={addChild}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
              title="Добавить подстатью"
            >
              <Plus className="h-3.5 w-3.5" /> Подстатья
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="rounded-md border border-neutral-300 p-1 text-muted-foreground hover:text-red-600 dark:border-neutral-700"
              aria-label="Удалить"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
      </div>

      {mode === 'edit' && canEdit ? (
        <>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Текст статьи в Markdown… (## заголовки, списки, **жирный**, таблицы, `код`)"
            className="min-h-[420px] w-full resize-y rounded-md border border-neutral-300 p-3 font-mono text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={pending || !dirty}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
            >
              {pending ? 'Сохранение…' : 'Сохранить'}
            </button>
            {saved ? (
              <span className="inline-flex items-center gap-1 text-sm text-emerald-600">
                <Check className="h-4 w-4" /> Сохранено
              </span>
            ) : null}
          </div>
        </>
      ) : (
        <article className="max-w-none break-words text-sm">
          {content.trim() ? renderMarkdown(content) : (
            <p className="text-muted-foreground">
              {canEdit ? 'Пустая статья. Нажмите «Редактор», чтобы наполнить.' : 'Пустая статья.'}
            </p>
          )}
        </article>
      )}
    </div>
  );
}
