'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Settings, Star, Trash2 } from 'lucide-react';
import {
  updateSpaceAction,
  deleteSpaceAction,
  createArticleAction,
  toggleFavoriteSpaceAction,
} from '@/actions/knowledge';
import { KbEmojiPicker } from './KbEmojiPicker';

const COLORS = ['#2563eb', '#16a34a', '#db2777', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#64748b'];

/**
 * Space page header: icon + name + description, star toggle (any user), a
 * "new article" button (editors), and an inline settings panel (ADMIN/PM):
 * rename, description, colour, icon, delete.
 */
export function KbSpaceHeader({
  spaceId,
  name,
  description,
  icon,
  color,
  articleCount,
  isFavorite,
  canManage,
  canEdit,
}: {
  spaceId: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  articleCount: number;
  isFavorite: boolean;
  canManage: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [favorite, setFavorite] = useState(isFavorite);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [draftDesc, setDraftDesc] = useState(description ?? '');
  const [draftColor, setDraftColor] = useState(color);

  function toggleStar() {
    const next = !favorite;
    setFavorite(next);
    startTransition(async () => {
      const res = await toggleFavoriteSpaceAction(spaceId);
      if (res.ok && res.data) {
        setFavorite(res.data.favorited);
        router.refresh();
      } else if (!res.ok) {
        setFavorite(!next);
        alert(res.error.message);
      }
    });
  }

  function setIcon(next: string | null) {
    startTransition(async () => {
      const res = await updateSpaceAction(spaceId, { icon: next });
      if (res.ok) router.refresh();
      else alert(res.error.message);
    });
  }

  function saveSettings() {
    startTransition(async () => {
      const res = await updateSpaceAction(spaceId, {
        name: draftName,
        description: draftDesc,
        color: draftColor,
      });
      if (res.ok) {
        setEditing(false);
        router.refresh();
      } else alert(res.error.message);
    });
  }

  function removeSpace() {
    if (!confirm(`Удалить пространство «${name}» со всеми статьями?`)) return;
    startTransition(async () => {
      const res = await deleteSpaceAction(spaceId);
      if (res.ok) router.push('/knowledge');
      else alert(res.error.message);
    });
  }

  function newArticle() {
    startTransition(async () => {
      const res = await createArticleAction(spaceId, null);
      if (res.ok && res.data) router.push(`/knowledge/${res.data.id}`);
      else if (!res.ok) alert(res.error.message);
    });
  }

  return (
    <header className="flex flex-col gap-3" style={color ? { borderLeft: `3px solid ${color}`, paddingLeft: 12 } : undefined}>
      <div className="flex items-start gap-3">
        {canManage ? (
          <KbEmojiPicker value={icon} onSelect={setIcon} disabled={pending} size="lg" />
        ) : (
          <span className="text-2xl">{icon ?? '📚'}</span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold">{name}</h1>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
          <p className="mt-1 text-xs text-muted-foreground">{articleCount} статей</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={toggleStar}
            disabled={pending}
            className={`rounded-md border border-neutral-300 p-1.5 dark:border-neutral-700 ${favorite ? 'text-amber-500' : 'text-muted-foreground hover:text-foreground'}`}
            aria-label={favorite ? 'Убрать из избранного' : 'В избранное'}
          >
            <Star className="h-4 w-4" fill={favorite ? 'currentColor' : 'none'} />
          </button>
          {canEdit ? (
            <button
              type="button"
              onClick={newArticle}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1.5 text-xs dark:border-neutral-700"
            >
              <Plus className="h-3.5 w-3.5" /> Статья
            </button>
          ) : null}
          {canManage ? (
            <button
              type="button"
              onClick={() => setEditing((e) => !e)}
              className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1.5 text-xs dark:border-neutral-700"
            >
              <Settings className="h-3.5 w-3.5" /> Настройки
            </button>
          ) : null}
        </div>
      </div>

      {editing && canManage ? (
        <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Название
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm text-foreground dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Описание
            <textarea
              value={draftDesc}
              onChange={(e) => setDraftDesc(e.target.value)}
              rows={2}
              className="resize-y rounded-md border border-neutral-300 px-2 py-1.5 text-sm text-foreground dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
          <div className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Цвет
            <div className="flex items-center gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setDraftColor(c)}
                  className={`h-6 w-6 rounded-full ${draftColor === c ? 'ring-2 ring-offset-2 ring-neutral-400 dark:ring-offset-neutral-900' : ''}`}
                  style={{ backgroundColor: c }}
                  aria-label={`Цвет ${c}`}
                />
              ))}
              <button
                type="button"
                onClick={() => setDraftColor(null)}
                className="ml-1 rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
              >
                Сбросить
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={saveSettings}
                disabled={pending}
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
              >
                {pending ? 'Сохранение…' : 'Сохранить'}
              </button>
              <button type="button" onClick={() => setEditing(false)} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted">
                Отмена
              </button>
            </div>
            <button
              type="button"
              onClick={removeSpace}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/40"
            >
              <Trash2 className="h-3.5 w-3.5" /> Удалить пространство
            </button>
          </div>
        </div>
      ) : null}
    </header>
  );
}
