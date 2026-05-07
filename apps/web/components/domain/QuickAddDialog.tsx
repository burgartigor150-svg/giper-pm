'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import {
  listMyProjects,
  quickAddTaskAction,
  type QuickAddProject,
} from '@/actions/tasks';

const LAST_PROJECT_KEY = 'giper:lastProjectKey';

/**
 * Single-field quick-add dialog. Mounts in AppShell, listens for the
 * `giper:quick-add-task` event (fired by the C shortcut, the topbar +
 * button, and the ⌘K palette action). One textarea for the title, one
 * select for the project, two buttons (создать / создать и открыть).
 *
 * Last-used project is remembered in localStorage so the typical "spawn
 * tasks for the same project all morning" flow doesn't ask twice.
 */
export function QuickAddDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<QuickAddProject[] | null>(null);
  const [projectKey, setProjectKey] = useState<string>('');
  const [parentTaskId, setParentTaskId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const titleRef = useRef<HTMLTextAreaElement>(null);

  // Hook into the global event bus. Event detail can carry overrides
  // (parentTaskId, projectKey) to scope the dialog — e.g. opening from
  // the "+ Подзадача" button on a task page locks the project to that
  // task's project and threads the parent id through to creation.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { parentTaskId?: string; projectKey?: string }
        | undefined;
      if (detail?.parentTaskId) setParentTaskId(detail.parentTaskId);
      if (detail?.projectKey) setProjectKey(detail.projectKey);
      setOpen(true);
    };
    window.addEventListener('giper:quick-add-task', onOpen);
    return () => window.removeEventListener('giper:quick-add-task', onOpen);
  }, []);

  // Lazy-load projects on first open. Subsequent opens reuse the list —
  // a stale list is fine (worst case the user picks a wrong project,
  // which they'd notice immediately).
  useEffect(() => {
    if (!open || projects !== null) return;
    listMyProjects().then((list) => {
      setProjects(list);
      const last =
        typeof window !== 'undefined' ? window.localStorage.getItem(LAST_PROJECT_KEY) : null;
      const initial =
        list.find((p) => p.key === last)?.key ?? list[0]?.key ?? '';
      setProjectKey(initial);
    });
  }, [open, projects]);

  // Reset transient state on close.
  useEffect(() => {
    if (!open) {
      setTitle('');
      setError(null);
      setParentTaskId(null);
    } else {
      // Focus textarea on next paint.
      setTimeout(() => titleRef.current?.focus(), 0);
    }
  }, [open]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const submit = useCallback(
    (openAfter: boolean) => {
      const t = title.trim();
      if (!projectKey) {
        setError('Выберите проект');
        return;
      }
      if (t.length < 2) {
        setError('Название — минимум 2 символа');
        return;
      }
      setError(null);
      startTransition(async () => {
        const res = await quickAddTaskAction({
          projectKey,
          title: t,
          parentTaskId: parentTaskId ?? undefined,
        });
        if (!res.ok) {
          setError(res.error.message);
          return;
        }
        try {
          window.localStorage.setItem(LAST_PROJECT_KEY, projectKey);
        } catch {}
        if (openAfter && res.data) {
          router.push(`/projects/${res.data.projectKey}/tasks/${res.data.number}`);
        } else {
          router.refresh();
        }
        setOpen(false);
      });
    },
    [projectKey, title, parentTaskId, router],
  );

  if (typeof document === 'undefined' || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 p-4 pt-[15vh]"
      onClick={() => !pending && setOpen(false)}
    >
      <div
        data-no-shortcuts
        className="w-full max-w-lg overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Plus className="h-4 w-4" />
            {parentTaskId ? 'Новая подзадача' : 'Новая задача'}
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded p-1 text-muted-foreground hover:bg-accent"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-3 p-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Проект
            </span>
            <select
              value={projectKey}
              onChange={(e) => setProjectKey(e.target.value)}
              disabled={!projects || pending}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              {!projects ? (
                <option>Загрузка…</option>
              ) : projects.length === 0 ? (
                <option value="">Нет доступных проектов</option>
              ) : (
                projects.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.key} · {p.name}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Название
            </span>
            <textarea
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                // ⌘/Ctrl+Enter — submit and stay; Shift+Enter — submit + open.
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submit(false);
                } else if (e.key === 'Enter' && e.shiftKey) {
                  e.preventDefault();
                  submit(true);
                } else if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                  // Plain Enter — submit and stay (most common: rapid spawn).
                  e.preventDefault();
                  submit(false);
                }
              }}
              rows={2}
              placeholder="Что нужно сделать"
              className="min-h-[64px] resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </label>

          {error ? <p className="text-xs text-red-600">{error}</p> : null}
        </div>

        <div className="flex items-center justify-between border-t px-4 py-2.5 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <Kbd>↵</Kbd> создать
            <Kbd>⇧↵</Kbd> создать и открыть
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Отмена
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => submit(false)}
              disabled={pending || !projectKey || title.trim().length < 2}
            >
              {pending ? 'Создаём…' : 'Создать'}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
      {children}
    </kbd>
  );
}
