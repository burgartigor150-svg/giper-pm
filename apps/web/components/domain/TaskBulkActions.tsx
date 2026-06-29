'use client';

import { createContext, useContext, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRightLeft, Check, ChevronDown, Flag, Rocket, Tag, Trash2, User2, X } from 'lucide-react';
import {
  bulkUpdateTasksAction,
  bulkDeleteTasksAction,
  type BulkTaskOp,
} from '@/actions/bulkTasks';
import { bulkMoveTasksOnBoardAction, type BoardMoveTarget } from '@/actions/boardBulk';

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

/**
 * Inline selection checkbox for a BOARD card. Shares the list view's selection
 * context, but must NOT start a drag — the whole KanbanCard is the @dnd-kit drag
 * handle, so we stopPropagation on pointerdown/click exactly like the card's
 * inner links do (KanbanCard.tsx). Rendered as the first item of the card's top
 * row (no absolute overlap with the priority dot / key).
 */
export function BoardCardCheckbox({ taskId }: { taskId: string }) {
  const { isSelected, toggle } = useSelection();
  return (
    <input
      type="checkbox"
      checked={isSelected(taskId)}
      onChange={() => toggle(taskId)}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label="Выбрать карточку"
      className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-input"
    />
  );
}

/**
 * Per-column "select all visible" row for the board. Feeds TaskHeaderCheckbox
 * the column's currently-rendered card ids; toggleAll already supports many
 * coexisting groups, so each column toggles independently. Renders nothing for
 * an empty column.
 */
export function BoardColumnSelectAll({ taskIds }: { taskIds: string[] }) {
  if (taskIds.length === 0) return null;
  return (
    <label className="flex cursor-pointer items-center gap-1.5 px-1 pb-1 text-xs text-muted-foreground">
      <TaskHeaderCheckbox taskIds={taskIds} />
      Выбрать все
    </label>
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
type TagOption = { id: string; name: string; color: string };
type SprintOption = { id: string; name: string };
/** A board move target the bar offers. `status` is the column's category. */
type BoardMoveColumn = { id: string; name: string; status: BulkStatus };
/** When set, the bar shows a board-native "Переместить" menu. */
type BoardMove = { freeForm: boolean; columns: BoardMoveColumn[] };
type Menu = 'status' | 'move' | 'assignee' | 'priority' | 'tag' | 'sprint' | null;

export function BulkTaskActionBar({
  members,
  tags = [],
  sprints = [],
  showStatus = true,
  boardMove,
}: {
  members: Member[];
  tags?: TagOption[];
  sprints?: SprintOption[];
  /** Show the Bitrix-mirror Status menu. Off on the board (mirror-only op would
   *  not reposition cards — the board uses `boardMove` instead). */
  showStatus?: boolean;
  /** Board-native move menu (status- or column-keyed). Omitted on the list. */
  boardMove?: BoardMove;
}) {
  const router = useRouter();
  const { selected, clear } = useSelection();
  const [menu, setMenu] = useState<Menu>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  // Two-step inline confirm for the destructive delete (no window.confirm).
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (selected.size === 0) return null;

  // Closing columns are never offered — bulk move mirrors single-card DnD, which
  // refuses closing moves (the action also rejects them server-side). Typed as a
  // guard so c.status narrows to the non-closing set the move target accepts.
  const moveColumns = (boardMove?.columns ?? []).filter(
    (c): c is BoardMoveColumn & { status: Exclude<BulkStatus, 'DONE' | 'CANCELED'> } =>
      c.status !== 'DONE' && c.status !== 'CANCELED',
  );

  function runMove(target: BoardMoveTarget) {
    setMenu(null);
    setResult(null);
    setConfirmDelete(false);
    startTransition(async () => {
      const res = await bulkMoveTasksOnBoardAction([...selected], target);
      if (res.ok) {
        reportTally(res.data.succeeded, res.data.failed);
        clear();
        router.refresh();
      } else {
        setResult(res.error.message);
      }
    });
  }

  function reportTally(succeeded: number, failed: number) {
    setResult(
      failed > 0
        ? `Готово: ${succeeded}, пропущено: ${failed} (нет прав или недоступны)`
        : `Готово: ${succeeded}`,
    );
  }

  function run(op: BulkTaskOp) {
    setMenu(null);
    setResult(null);
    setConfirmDelete(false);
    startTransition(async () => {
      const res = await bulkUpdateTasksAction([...selected], op);
      if (res.ok) {
        reportTally(res.data.succeeded, res.data.failed);
        clear();
        router.refresh();
      } else {
        setResult(res.error.message);
      }
    });
  }

  function runDelete() {
    setMenu(null);
    setResult(null);
    setConfirmDelete(false);
    startTransition(async () => {
      const res = await bulkDeleteTasksAction([...selected]);
      if (res.ok) {
        reportTally(res.data.succeeded, res.data.failed);
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

          {showStatus ? (
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
          ) : null}

          {boardMove ? (
            <BulkMenu
              open={menu === 'move'}
              onToggle={() => setMenu((m) => (m === 'move' ? null : 'move'))}
              label="Переместить"
              icon={<ArrowRightLeft className="h-4 w-4" aria-hidden />}
              disabled={pending}
            >
              {moveColumns.length === 0 ? (
                <span className="block px-2 py-1.5 text-xs text-muted-foreground">
                  Нет доступных колонок
                </span>
              ) : (
                moveColumns.map((c) => (
                  <MenuItem
                    key={c.id}
                    onClick={() =>
                      runMove(
                        boardMove.freeForm
                          ? { kind: 'column', columnId: c.id }
                          : { kind: 'status', status: c.status },
                      )
                    }
                  >
                    {c.name}
                  </MenuItem>
                ))
              )}
            </BulkMenu>
          ) : null}

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

          {tags.length > 0 ? (
            <BulkMenu
              open={menu === 'tag'}
              onToggle={() => setMenu((m) => (m === 'tag' ? null : 'tag'))}
              label="Тег"
              icon={<Tag className="h-4 w-4" aria-hidden />}
              disabled={pending}
            >
              {tags.map((tg) => (
                <MenuItem key={tg.id} onClick={() => run({ kind: 'addTag', tagId: tg.id })}>
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: tg.color }}
                      aria-hidden
                    />
                    {tg.name}
                  </span>
                </MenuItem>
              ))}
            </BulkMenu>
          ) : null}

          {sprints.length > 0 ? (
            <BulkMenu
              open={menu === 'sprint'}
              onToggle={() => setMenu((m) => (m === 'sprint' ? null : 'sprint'))}
              label="Спринт"
              icon={<Rocket className="h-4 w-4" aria-hidden />}
              disabled={pending}
            >
              <MenuItem onClick={() => run({ kind: 'sprint', sprintId: null })}>
                <span className="text-muted-foreground">— Убрать из спринта</span>
              </MenuItem>
              {sprints.map((s) => (
                <MenuItem key={s.id} onClick={() => run({ kind: 'sprint', sprintId: s.id })}>
                  {s.name}
                </MenuItem>
              ))}
            </BulkMenu>
          ) : null}

          {confirmDelete ? (
            <span className="inline-flex items-center gap-1.5">
              <button
                type="button"
                onClick={runDelete}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-md border border-destructive bg-destructive px-2.5 py-1.5 font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Удалить {selected.size}?
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={pending}
                className="rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                Отмена
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => {
                setMenu(null);
                setConfirmDelete(true);
              }}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1.5 font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              Удалить
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setConfirmDelete(false);
              clear();
            }}
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
