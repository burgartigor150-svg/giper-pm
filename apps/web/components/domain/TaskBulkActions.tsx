'use client';

import { createContext, useContext, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, Flag, User2, X } from 'lucide-react';
import { bulkUpdateTasksAction, type BulkTaskOp } from '@/actions/bulkTasks';

/**
 * Multi-select + bulk-action toolbar for the task LIST view. Selection state
 * lives in a context so server-rendered rows can mount a checkbox without
 * prop-drilling. When ≥1 row is selected, a floating bar offers bulk Status /
 * Assignee / Priority. Authorization is enforced per-task server-side; the bar
 * just reports the {succeeded, failed} tally.
 */

type Ctx = {
  selected: Set<string>;
  toggle: (id: string) => void;
  toggleAll: (ids: string[]) => void;
  clear: () => void;
  isSelected: (id: string) => boolean;
};

const SelectionCtx = createContext<Ctx | null>(null);

export function TaskSelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const ctx = useMemo<Ctx>(
    () => ({
      selected,
      toggle: (id) =>
        setSelected((cur) => {
          const next = new Set(cur);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      toggleAll: (ids) =>
        setSelected((cur) => {
          const allSelected = ids.length > 0 && ids.every((id) => cur.has(id));
          if (allSelected) {
            const next = new Set(cur);
            for (const id of ids) next.delete(id);
            return next;
          }
          return new Set([...cur, ...ids]);
        }),
      clear: () => setSelected(new Set()),
      isSelected: (id) => selected.has(id),
    }),
    [selected],
  );
  return <SelectionCtx.Provider value={ctx}>{children}</SelectionCtx.Provider>;
}

function useSelection(): Ctx {
  const ctx = useContext(SelectionCtx);
  if (!ctx) throw new Error('useSelection must be used inside TaskSelectionProvider');
  return ctx;
}

export function TaskRowCheckbox({ taskId }: { taskId: string }) {
  const { isSelected, toggle } = useSelection();
  return (
    <input
      type="checkbox"
      checked={isSelected(taskId)}
      onChange={() => toggle(taskId)}
      aria-label="Выбрать задачу"
      className="h-4 w-4 cursor-pointer rounded border-input"
    />
  );
}

export function TaskHeaderCheckbox({ taskIds }: { taskIds: string[] }) {
  const { selected, toggleAll } = useSelection();
  const allSelected = taskIds.length > 0 && taskIds.every((id) => selected.has(id));
  const someSelected = taskIds.some((id) => selected.has(id));
  return (
    <input
      type="checkbox"
      checked={allSelected}
      ref={(el) => {
        if (el) el.indeterminate = !allSelected && someSelected;
      }}
      onChange={() => toggleAll(taskIds)}
      aria-label="Выбрать все на странице"
      className="h-4 w-4 cursor-pointer rounded border-input"
    />
  );
}

type BulkStatus = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'BLOCKED' | 'DONE' | 'CANCELED';
const STATUS_OPTIONS: { value: BulkStatus; label: string }[] = [
  { value: 'BACKLOG', label: 'Бэклог' },
  { value: 'TODO', label: 'К работе' },
  { value: 'IN_PROGRESS', label: 'В работе' },
  { value: 'REVIEW', label: 'На ревью' },
  { value: 'BLOCKED', label: 'Заблокирована' },
  { value: 'DONE', label: 'Готово' },
  { value: 'CANCELED', label: 'Отменена' },
];
const PRIORITY_OPTIONS: { value: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'; label: string }[] = [
  { value: 'LOW', label: 'Низкий' },
  { value: 'MEDIUM', label: 'Средний' },
  { value: 'HIGH', label: 'Высокий' },
  { value: 'URGENT', label: 'Срочный' },
];

type Member = { id: string; name: string };
type Menu = 'status' | 'assignee' | 'priority' | null;

export function BulkTaskActionBar({ members }: { members: Member[] }) {
  const router = useRouter();
  const { selected, clear } = useSelection();
  const [menu, setMenu] = useState<Menu>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  if (selected.size === 0) return null;

  function run(op: BulkTaskOp) {
    setMenu(null);
    setResult(null);
    startTransition(async () => {
      const res = await bulkUpdateTasksAction([...selected], op);
      if (res.ok) {
        const { succeeded, failed } = res.data;
        setResult(
          failed > 0
            ? `Готово: ${succeeded}, пропущено: ${failed} (нет прав или недоступны)`
            : `Готово: ${succeeded}`,
        );
        clear();
        router.refresh();
      } else {
        setResult(res.error.message);
      }
    });
  }

  return (
    <div className="fixed inset-x-0 bottom-4 z-40 mx-auto flex max-w-2xl justify-center px-4">
      <div className="flex w-full flex-col gap-2 rounded-xl border border-border bg-popover p-3 text-sm shadow-2xl">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">Выбрано: {selected.size}</span>

          <BulkMenu
            open={menu === 'status'}
            onToggle={() => setMenu((m) => (m === 'status' ? null : 'status'))}
            label="Статус"
            icon={<Check className="h-4 w-4" aria-hidden />}
            disabled={pending}
          >
            {STATUS_OPTIONS.map((s) => (
              <MenuItem key={s.value} onClick={() => run({ kind: 'status', status: s.value })}>
                {s.label}
              </MenuItem>
            ))}
          </BulkMenu>

          <BulkMenu
            open={menu === 'assignee'}
            onToggle={() => setMenu((m) => (m === 'assignee' ? null : 'assignee'))}
            label="Исполнитель"
            icon={<User2 className="h-4 w-4" aria-hidden />}
            disabled={pending}
          >
            <MenuItem onClick={() => run({ kind: 'assignee', assigneeId: null })}>
              <span className="text-muted-foreground">— Снять исполнителя</span>
            </MenuItem>
            {members.map((m) => (
              <MenuItem key={m.id} onClick={() => run({ kind: 'assignee', assigneeId: m.id })}>
                {m.name}
              </MenuItem>
            ))}
          </BulkMenu>

          <BulkMenu
            open={menu === 'priority'}
            onToggle={() => setMenu((m) => (m === 'priority' ? null : 'priority'))}
            label="Приоритет"
            icon={<Flag className="h-4 w-4" aria-hidden />}
            disabled={pending}
          >
            {PRIORITY_OPTIONS.map((p) => (
              <MenuItem key={p.value} onClick={() => run({ kind: 'priority', priority: p.value })}>
                {p.label}
              </MenuItem>
            ))}
          </BulkMenu>

          <button
            type="button"
            onClick={clear}
            disabled={pending}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" aria-hidden />
            Снять
          </button>
        </div>
        {result ? <p className="text-xs text-muted-foreground">{result}</p> : null}
      </div>
    </div>
  );
}

function BulkMenu({
  open,
  onToggle,
  label,
  icon,
  disabled,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  icon: React.ReactNode;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1.5 font-medium transition-colors hover:bg-muted disabled:opacity-50"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {icon}
        {label}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={onToggle} aria-hidden />
          <div className="absolute bottom-full left-0 z-20 mb-1 max-h-64 w-52 overflow-auto rounded-md border bg-background p-1 shadow-lg" role="menu">
            {children}
          </div>
        </>
      ) : null}
    </div>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
      role="menuitem"
    >
      {children}
    </button>
  );
}
