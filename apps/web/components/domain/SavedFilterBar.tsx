'use client';

import { useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Bookmark, ChevronDown, Star, Share2, Trash2, X } from 'lucide-react';
import { normalizeFilterQuery } from '@giper/shared';
import { Input } from '@giper/ui/components/Input';
import {
  createSavedFilterAction,
  deleteSavedFilterAction,
  setDefaultSavedFilterAction,
} from '@/actions/savedFilters';
import type { SavedFilterView } from '@/lib/savedFilters/listSavedFiltersForView';

type Props = {
  projectKey: string;
  scope: 'BOARD' | 'LIST';
  presets: SavedFilterView[];
  /** Whether the viewer may publish/prune SHARED presets (canEditProject). */
  canShare: boolean;
};

/**
 * Saved-filter bar for the board/list views. Lets a user save the current filter
 * state as a named preset, switch between presets in one click, mark a default,
 * and delete their own (or, with project-edit, shared) presets. Applying a preset
 * is a pure replay of its stored URL params — it never bypasses access control.
 */
export function SavedFilterBar({ projectKey, scope, presets, canShare }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [openList, setOpenList] = useState(false);
  const [openSave, setOpenSave] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [share, setShare] = useState(false);
  const [makeDefault, setMakeDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveRef = useRef<HTMLDivElement>(null);

  // Current filter params (minus pagination) as a query string + its normalized
  // form for active-preset comparison.
  const currentQuery = (() => {
    const sp = new URLSearchParams(params.toString());
    sp.delete('page');
    return sp.toString();
  })();
  const normalizedCurrent = normalizeFilterQuery(currentQuery) ?? '';
  const hasActiveFilters = normalizedCurrent.length > 0;

  function applyPreset(query: string) {
    setOpenList(false);
    startTransition(() => router.push(query ? `?${query}` : pathname, { scroll: false }));
  }

  // If the viewer has a default preset, a bare reset would just re-apply it on
  // reload. Use the `reset` sentinel so the page treats it as an explicit
  // "no filters" state and skips the default. Without a default, a clean URL.
  const hasDefault = presets.some((p) => p.isDefault);
  function resetFilters() {
    setOpenList(false);
    startTransition(() =>
      router.push(hasDefault ? `${pathname}?reset=1` : pathname, { scroll: false }),
    );
  }

  function save() {
    setError(null);
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError('Название: минимум 2 символа');
      return;
    }
    startTransition(async () => {
      const res = await createSavedFilterAction({
        projectKey,
        scope,
        name: trimmed,
        query: currentQuery,
        isShared: canShare ? share : false,
        isDefault: makeDefault,
      });
      if (res.ok) {
        setOpenSave(false);
        setName('');
        setShare(false);
        setMakeDefault(false);
        router.refresh();
      } else {
        setError(res.error.message);
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteSavedFilterAction(id);
      if (res.ok) router.refresh();
      else setError(res.error.message);
    });
  }

  function toggleDefault(preset: SavedFilterView) {
    startTransition(async () => {
      const res = await setDefaultSavedFilterAction(preset.id, !preset.isDefault);
      if (res.ok) router.refresh();
      else setError(res.error.message);
    });
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${pending ? 'opacity-60' : ''}`}>
      {/* Presets dropdown */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpenList((o) => !o)}
          className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
          aria-haspopup="menu"
          aria-expanded={openList}
        >
          <Bookmark className="h-4 w-4" aria-hidden />
          Пресеты
          {presets.length > 0 ? (
            <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
              {presets.length}
            </span>
          ) : null}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        </button>
        {openList ? (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpenList(false)} aria-hidden />
            <div
              className="absolute left-0 z-20 mt-1 max-h-80 w-72 overflow-auto rounded-md border bg-background p-1 shadow-lg"
              role="menu"
            >
              {presets.length === 0 ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">
                  Нет сохранённых фильтров. Настройте фильтры и нажмите «Сохранить».
                </p>
              ) : (
                presets.map((p) => {
                  const active = p.query === normalizedCurrent;
                  return (
                    <div
                      key={p.id}
                      className={`group flex items-center gap-1 rounded px-1 ${active ? 'bg-muted' : 'hover:bg-muted/60'}`}
                    >
                      <button
                        type="button"
                        onClick={() => applyPreset(p.query)}
                        className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-sm"
                      >
                        {p.isDefault ? (
                          <Star className="h-3.5 w-3.5 shrink-0 fill-current text-amber-500" aria-label="по умолчанию" />
                        ) : null}
                        <span className="truncate">{p.name}</span>
                        {p.isShared ? (
                          <Share2 className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="общий" />
                        ) : null}
                      </button>
                      {p.isMine ? (
                        <button
                          type="button"
                          onClick={() => toggleDefault(p)}
                          title={p.isDefault ? 'Убрать из «по умолчанию»' : 'Сделать по умолчанию'}
                          className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition hover:text-foreground group-hover:opacity-100"
                        >
                          <Star className={`h-3.5 w-3.5 ${p.isDefault ? 'fill-current text-amber-500' : ''}`} aria-hidden />
                        </button>
                      ) : null}
                      {p.isMine || canShare ? (
                        <button
                          type="button"
                          onClick={() => remove(p.id)}
                          title="Удалить пресет"
                          className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </>
        ) : null}
      </div>

      {/* Save current filter */}
      <div ref={saveRef} className="relative">
        <button
          type="button"
          onClick={() => {
            setOpenSave((o) => !o);
            setError(null);
          }}
          disabled={!hasActiveFilters}
          title={hasActiveFilters ? 'Сохранить текущий фильтр' : 'Сначала настройте фильтры'}
          className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
        >
          Сохранить фильтр
        </button>
        {openSave ? (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpenSave(false)} aria-hidden />
            <div className="absolute left-0 z-20 mt-1 w-72 rounded-md border bg-background p-3 shadow-lg">
              <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="sf-name">
                Название пресета
              </label>
              <Input
                id="sf-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Например: Мои просроченные"
                maxLength={80}
                className="h-9"
                autoFocus
              />
              {canShare ? (
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
                  Доступен команде
                </label>
              ) : null}
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={makeDefault}
                  onChange={(e) => setMakeDefault(e.target.checked)}
                />
                Сделать по умолчанию
              </label>
              {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpenSave(false)}
                  className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={pending}
                  className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  Сохранить
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>

      {hasActiveFilters ? (
        <button
          type="button"
          onClick={resetFilters}
          className="inline-flex items-center gap-1 rounded text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          Сбросить
        </button>
      ) : null}
    </div>
  );
}
