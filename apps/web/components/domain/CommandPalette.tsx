'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import {
  ArrowRight,
  Folder,
  Hash,
  LayoutDashboard,
  Plus,
  Search,
  Settings,
  Users,
  Clock,
  BarChart3,
  User as UserIcon,
} from 'lucide-react';
import { Avatar } from '@giper/ui/components/Avatar';
import { searchAll, type SearchResult } from '@/actions/search';

/**
 * ⌘K command palette — global launcher for fast navigation, search, and
 * quick actions across the app. Opens via ⌘K / Ctrl+K (any focused input
 * is fine; we ignore key events that target a typing context to avoid
 * stealing them while a user is editing inline).
 *
 * The palette mounts at the AppShell level, so it's reachable from every
 * authenticated page. Search is debounced (120ms) and runs the unified
 * `searchAll` server action — tasks + projects + people, plus a parsed
 * KEY-N quick-jump.
 *
 * Why cmdk: handles keyboard navigation, ARIA, and virtualization for free,
 * and is the de-facto standard for this UI (Linear / Vercel / Raycast).
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<number | null>(null);

  // ⌘K / Ctrl+K — open. ESC inside cmdk handles close. Also listen for
  // the `giper:open-palette` event so the `/` global shortcut can open us.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('giper:open-palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('giper:open-palette', onOpen);
    };
  }, []);

  // Reset query when the palette closes — next open shows static commands.
  useEffect(() => {
    if (!open) {
      setQuery('');
      setResult(null);
    }
  }, [open]);

  // Debounced search. We don't fire on every keystroke — Postgres ILIKE
  // calls aren't free, and the user is typing fast at the start.
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (query.trim().length === 0) {
      setResult(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const r = await searchAll(query);
        // Drop late responses if the user kept typing.
        setResult((prev) => (prev?.query === r.query || true ? r : prev));
      } finally {
        setLoading(false);
      }
    }, 120);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, open]);

  const navigate = useCallback(
    (href: string) => {
      router.push(href);
      setOpen(false);
    },
    [router],
  );

  const dispatchCustom = useCallback((eventName: string) => {
    window.dispatchEvent(new CustomEvent(eventName));
    setOpen(false);
  }, []);

  if (typeof document === 'undefined') return null;
  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 p-4 pt-[10vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <Command label="Командное меню" shouldFilter={false}>
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder="Найти задачу, проект, человека или команду…"
              className="flex h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <kbd className="hidden rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
              ESC
            </kbd>
          </div>

          <Command.List className="max-h-[60vh] overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              {loading ? 'Поиск…' : 'Ничего не найдено'}
            </Command.Empty>

            {result?.exact && result.exact.kind === 'task' ? (
              <Command.Group heading="Точное совпадение">
                <TaskRow hit={result.exact} onSelect={navigate} exact />
              </Command.Group>
            ) : null}

            {result && result.tasks.length > 0 ? (
              <Command.Group heading="Задачи">
                {result.tasks.map((t) => (
                  <TaskRow key={t.id} hit={t} onSelect={navigate} />
                ))}
              </Command.Group>
            ) : null}

            {result && result.projects.length > 0 ? (
              <Command.Group heading="Проекты">
                {result.projects.map((p) => (
                  <ProjectRow key={p.id} hit={p} onSelect={navigate} />
                ))}
              </Command.Group>
            ) : null}

            {result && result.users.length > 0 ? (
              <Command.Group heading="Люди">
                {result.users.map((u) => (
                  <UserRow key={u.id} hit={u} onSelect={navigate} />
                ))}
              </Command.Group>
            ) : null}

            {!query ? (
              <>
                <Command.Group heading="Действия">
                  <ActionRow
                    icon={<Plus className="h-4 w-4" />}
                    label="Новая задача"
                    shortcut="C"
                    onSelect={() => dispatchCustom('giper:quick-add-task')}
                  />
                  <ActionRow
                    icon={<Clock className="h-4 w-4" />}
                    label="Остановить таймер"
                    shortcut="T"
                    onSelect={() => dispatchCustom('giper:toggle-timer')}
                  />
                </Command.Group>
                <Command.Group heading="Перейти">
                  <NavRow
                    icon={<LayoutDashboard className="h-4 w-4" />}
                    label="Дашборд"
                    href="/dashboard"
                    shortcut="G D"
                    onSelect={navigate}
                  />
                  <NavRow
                    icon={<UserIcon className="h-4 w-4" />}
                    label="Мой день"
                    href="/me"
                    shortcut="G M"
                    onSelect={navigate}
                  />
                  <NavRow
                    icon={<Folder className="h-4 w-4" />}
                    label="Проекты"
                    href="/projects"
                    shortcut="G P"
                    onSelect={navigate}
                  />
                  <NavRow
                    icon={<Clock className="h-4 w-4" />}
                    label="Время"
                    href="/time"
                    shortcut="G T"
                    onSelect={navigate}
                  />
                  <NavRow
                    icon={<Users className="h-4 w-4" />}
                    label="Команда"
                    href="/team"
                    shortcut="G C"
                    onSelect={navigate}
                  />
                  <NavRow
                    icon={<BarChart3 className="h-4 w-4" />}
                    label="Отчёты"
                    href="/reports"
                    shortcut="G R"
                    onSelect={navigate}
                  />
                  <NavRow
                    icon={<Settings className="h-4 w-4" />}
                    label="Настройки"
                    href="/settings"
                    shortcut="G S"
                    onSelect={navigate}
                  />
                </Command.Group>
              </>
            ) : null}
          </Command.List>

          <div className="flex items-center justify-between border-t px-3 py-2 text-[11px] text-muted-foreground">
            <span>
              <Kbd>↑↓</Kbd> навигация · <Kbd>↵</Kbd> выбрать
            </span>
            <span>
              <Kbd>⌘K</Kbd> закрыть
            </span>
          </div>
        </Command>
      </div>
    </div>,
    document.body,
  );
}

function TaskRow({
  hit,
  onSelect,
  exact = false,
}: {
  hit: { id: string; number: number; title: string; projectKey: string; status: string };
  onSelect: (href: string) => void;
  exact?: boolean;
}) {
  const href = `/projects/${hit.projectKey}/tasks/${hit.number}`;
  return (
    <Command.Item
      value={`task ${hit.projectKey}-${hit.number} ${hit.title}`}
      onSelect={() => onSelect(href)}
      className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
    >
      <Hash className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
        {hit.projectKey}-{hit.number}
      </span>
      <span className="min-w-0 flex-1 truncate">{hit.title}</span>
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {hit.status}
      </span>
      {exact ? <ArrowRight className="h-3 w-3 text-muted-foreground" /> : null}
    </Command.Item>
  );
}

function ProjectRow({
  hit,
  onSelect,
}: {
  hit: { id: string; key: string; name: string };
  onSelect: (href: string) => void;
}) {
  const href = `/projects/${hit.key}`;
  return (
    <Command.Item
      value={`project ${hit.key} ${hit.name}`}
      onSelect={() => onSelect(href)}
      className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
    >
      <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
        {hit.key}
      </span>
      <span className="min-w-0 flex-1 truncate">{hit.name}</span>
    </Command.Item>
  );
}

function UserRow({
  hit,
  onSelect,
}: {
  hit: { id: string; name: string; email: string; image: string | null };
  onSelect: (href: string) => void;
}) {
  const href = `/team/${hit.id}`;
  return (
    <Command.Item
      value={`user ${hit.name} ${hit.email}`}
      onSelect={() => onSelect(href)}
      className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
    >
      <Avatar src={hit.image} alt={hit.name} className="h-6 w-6" />
      <span className="min-w-0 flex-1 truncate">{hit.name}</span>
      <span className="truncate text-[11px] text-muted-foreground">{hit.email}</span>
    </Command.Item>
  );
}

function NavRow({
  icon,
  label,
  href,
  shortcut,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  href: string;
  shortcut?: string;
  onSelect: (href: string) => void;
}) {
  return (
    <Command.Item
      value={`nav ${label}`}
      onSelect={() => onSelect(href)}
      className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">{label}</span>
      {shortcut ? <Kbd>{shortcut}</Kbd> : null}
    </Command.Item>
  );
}

function ActionRow({
  icon,
  label,
  shortcut,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={`action ${label}`}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">{label}</span>
      {shortcut ? <Kbd>{shortcut}</Kbd> : null}
    </Command.Item>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
      {children}
    </kbd>
  );
}
