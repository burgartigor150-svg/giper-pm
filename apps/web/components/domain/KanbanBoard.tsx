'use client';

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable';
import { GripVertical, Plus, Check, X } from 'lucide-react';
import type { BoardTask, BoardColumnView, BoardSwimlaneView } from '@/lib/tasks';
import { changeStatusAction } from '@/actions/tasks';
import { setInternalStatusAction } from '@/actions/assignments';
import {
  setTaskSwimlaneAction,
  setTaskSubColumnAction,
  reorderBoardSwimlanesAction,
  renameBoardSwimlaneAction,
  createBoardSwimlaneAction,
} from '@/actions/board';
import { useT } from '@/lib/useT';
import { KanbanCard } from './KanbanCard';
import { KanbanColumn } from './KanbanColumn';

type Status = BoardTask['status'];

const COLUMN_CAP = 50;
const TOTAL_THRESHOLD = 200;
/** Sentinel lane key for cards not assigned to any swimlane. */
const NO_LANE = 'none';

type Props = {
  projectKey: string;
  /** Project id — needed to create swimlanes inline. */
  projectId: string;
  initialTasks: BoardTask[];
  /** Columns in display order (first-class rows or synthesized defaults). */
  columns: BoardColumnView[];
  /** Swimlanes in display order. Empty → single implicit lane (today's view). */
  swimlanes?: BoardSwimlaneView[];
  /** ADMIN/owner/LEAD — may reorder/rename/add swimlanes inline. */
  canManage?: boolean;
};

/** A drop target resolved from a droppable/card id: which column + which lane. */
type DropTarget = { status: Status; laneKey: string; subColumnId?: string };

/**
 * Collision routing: a swimlane drag (active.data.type==='lane') only considers
 * lane droppables; a card drag only considers the rest. This keeps the large
 * lane droppable from stealing card drops and vice-versa, so the existing card
 * DnD behaves exactly as before.
 */
const boardCollision: CollisionDetection = (args) => {
  const isLane = args.active.data.current?.type === 'lane';
  const droppableContainers = args.droppableContainers.filter((c) =>
    isLane ? c.data.current?.type === 'lane' : c.data.current?.type !== 'lane',
  );
  return isLane
    ? closestCenter({ ...args, droppableContainers })
    : rectIntersection({ ...args, droppableContainers });
};

export function KanbanBoard({
  projectKey,
  projectId,
  initialTasks,
  columns,
  swimlanes = [],
  canManage = false,
}: Props) {
  const router = useRouter();
  const tBoard = useT('tasks.board');

  const [tasks, setTasks] = useState<BoardTask[]>(initialTasks);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeLaneId, setActiveLaneId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Local swimlane order for snappy drag-reorder (re-synced when the server set
  // changes via router.refresh). Only real lanes — the implicit lane is pinned.
  const swimlaneKey = swimlanes.map((s) => s.id).join(',');
  const [laneOrder, setLaneOrder] = useState<string[]>(() => swimlanes.map((s) => s.id));
  useEffect(() => setLaneOrder(swimlanes.map((s) => s.id)), [swimlaneKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const hasLanes = swimlanes.length > 0;

  // Column totals (across all lanes) — drives the single-lane view and the
  // per-column WIP check, which is board-wide regardless of swimlanes.
  const byStatus = useMemo(() => {
    const map = new Map<Status, BoardTask[]>();
    for (const c of columns) map.set(c.status, []);
    for (const t of tasks) {
      const arr = map.get(t.internalStatus);
      if (arr) arr.push(t);
    }
    return map;
  }, [tasks, columns]);

  // Tasks bucketed by `${laneKey}::${status}` for the band view.
  const byLaneStatus = useMemo(() => {
    const map = new Map<string, BoardTask[]>();
    for (const t of tasks) {
      const key = `${t.swimlaneId ?? NO_LANE}::${t.internalStatus}`;
      const arr = map.get(key);
      if (arr) arr.push(t);
      else map.set(key, [t]);
    }
    return map;
  }, [tasks]);

  const useCap = tasks.length > TOTAL_THRESHOLD;
  const activeTask = activeId ? tasks.find((t) => t.id === activeId) ?? null : null;

  // Band rows: the implicit "no lane" first, then the configured swimlanes in
  // the (optimistic) local order.
  const lanes = useMemo(() => {
    const byId = new Map(swimlanes.map((s) => [s.id, s]));
    const ordered = laneOrder
      .map((id) => byId.get(id))
      .filter((s): s is BoardSwimlaneView => Boolean(s));
    return [
      { id: NO_LANE, name: 'Без дорожки', wipLimit: null as number | null },
      ...ordered.map((s) => ({ id: s.id, name: s.name, wipLimit: s.wipLimit })),
    ];
  }, [swimlanes, laneOrder]);

  function findTarget(id: string): DropTarget | null {
    // Sub-column droppable: `subcol-<laneKey>-<STATUS>-<subColumnId>`. None of
    // laneKey (cuid / NO_LANE), STATUS (A-Z_) or subColumnId (cuid) contain a
    // dash, so split('-') yields exactly [laneKey, status, subColumnId].
    if (id.startsWith('subcol-')) {
      const parts = id.slice('subcol-'.length).split('-');
      if (parts.length !== 3) return null;
      return { laneKey: parts[0]!, status: parts[1] as Status, subColumnId: parts[2] };
    }
    // Band droppable: `cell-<laneKey>-<STATUS>` (laneKey is a cuid or NO_LANE,
    // status has no dash — split on the last dash).
    if (id.startsWith('cell-')) {
      const rest = id.slice('cell-'.length);
      const idx = rest.lastIndexOf('-');
      if (idx === -1) return null;
      return { laneKey: rest.slice(0, idx), status: rest.slice(idx + 1) as Status };
    }
    // Single-lane droppable: `column-<STATUS>` (unchanged from before swimlanes).
    if (id.startsWith('column-')) {
      return { laneKey: NO_LANE, status: id.slice('column-'.length) as Status };
    }
    const t = tasks.find((tt) => tt.id === id);
    if (!t) return null;
    return {
      laneKey: t.swimlaneId ?? NO_LANE,
      status: t.internalStatus,
      subColumnId: t.subColumnId ?? undefined,
    };
  }

  function handleDragStart(e: DragStartEvent) {
    setError(null);
    if (e.active.data.current?.type === 'lane') {
      setActiveLaneId(String(e.active.id).replace(/^lane-/, ''));
      return;
    }
    setActiveId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;

    // Swimlane reorder — separate from card moves (routed by boardCollision).
    if (active.data.current?.type === 'lane') {
      setActiveLaneId(null);
      if (!over) return;
      const fromId = String(active.id).replace(/^lane-/, '');
      const overId = String(over.id);
      const toId = overId.startsWith('lanedrop-')
        ? overId.slice('lanedrop-'.length)
        : overId.replace(/^lane-/, '');
      if (!toId || toId === fromId) return;
      const fromIdx = laneOrder.indexOf(fromId);
      const toIdx = laneOrder.indexOf(toId);
      if (fromIdx < 0 || toIdx < 0) return;
      const next = arrayMove(laneOrder, fromIdx, toIdx);
      const prevOrder = laneOrder;
      setLaneOrder(next); // optimistic
      startTransition(async () => {
        const res = await reorderBoardSwimlanesAction(projectId, next);
        if (res.ok) router.refresh();
        else {
          setLaneOrder(prevOrder);
          setError(res.error.message);
        }
      });
      return;
    }

    setActiveId(null);
    if (!over) return;

    const from = findTarget(String(active.id));
    const to = findTarget(String(over.id));
    if (!from || !to) return;

    const taskId = String(active.id);
    const sameStatus = from.status === to.status;
    const sameLane = from.laneKey === to.laneKey;
    const sameSubColumn = (from.subColumnId ?? null) === (to.subColumnId ?? null);

    if (sameStatus && sameLane && sameSubColumn) {
      // Reorder within the same cell — local only, not persisted.
      const arr = hasLanes
        ? byLaneStatus.get(`${from.laneKey}::${from.status}`) ?? []
        : byStatus.get(from.status) ?? [];
      const oldIndex = arr.findIndex((t) => t.id === active.id);
      const newIndex = arr.findIndex((t) => t.id === over.id);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
      const reordered = arrayMove(arr, oldIndex, newIndex);
      const inCell = new Set(arr.map((t) => t.id));
      const others = tasks.filter((t) => !inCell.has(t.id));
      setTasks([...others, ...reordered]);
      return;
    }

    const prevSnapshot = tasks;
    const newStatus = to.status;
    const newSwimlaneId = to.laneKey === NO_LANE ? null : to.laneKey;
    const newSubColumnId = to.subColumnId ?? null;

    // Hard WIP enforcement. Column WIP is board-wide (per status); a
    // lane move also checks the destination lane's own WIP. Refuse → card stays.
    if (!sameStatus) {
      const targetCol = columns.find((c) => c.status === newStatus);
      const targetCount = byStatus.get(newStatus)?.length ?? 0;
      if (targetCol?.wipLimit != null && targetCount >= targetCol.wipLimit) {
        setError(`Колонка «${targetCol.name}» заполнена (WIP-лимит ${targetCol.wipLimit}).`);
        return;
      }
    }
    if (!sameLane && newSwimlaneId) {
      const lane = swimlanes.find((s) => s.id === newSwimlaneId);
      const laneCount = tasks.filter((t) => t.swimlaneId === newSwimlaneId).length;
      if (lane?.wipLimit != null && laneCount >= lane.wipLimit) {
        setError(`Дорожка «${lane.name}» заполнена (WIP-лимит ${lane.wipLimit}).`);
        return;
      }
    }
    if (!sameSubColumn && newSubColumnId) {
      const targetSub = columns
        .find((c) => c.status === newStatus)
        ?.subColumns.find((s) => s.id === newSubColumnId);
      const subCount = tasks.filter((t) => t.subColumnId === newSubColumnId).length;
      if (targetSub?.wipLimit != null && subCount >= targetSub.wipLimit) {
        setError(`Подколонка «${targetSub.name}» заполнена (WIP-лимит ${targetSub.wipLimit}).`);
        return;
      }
    }

    const moved = prevSnapshot.find((t) => t.id === taskId);
    if (!moved) return;

    // Closing requires an итог, which we can't collect mid-drag — send the user
    // to the task card (which has the result dialog). Card stays put.
    if (!sameStatus && newStatus === 'DONE') {
      setError('Чтобы закрыть задачу, откройте её и укажите итог при закрытии.');
      return;
    }

    // Optimistic: update internalStatus + swimlaneId on the moved card. Mirror
    // `status` is owned by Bitrix and only updated by the sync round-trip.
    setTasks((cur) =>
      cur.map((t) =>
        t.id === taskId
          ? { ...t, internalStatus: newStatus, swimlaneId: newSwimlaneId, subColumnId: newSubColumnId }
          : t,
      ),
    );

    startTransition(async () => {
      let ok = true;
      if (!sameStatus) {
        const res = moved.externalSource
          ? await setInternalStatusAction(taskId, projectKey, moved.number, newStatus)
          : await changeStatusAction(taskId, projectKey, moved.number, newStatus);
        ok = res.ok;
        // Native task: keep internalStatus (the board track) in sync with the
        // mirror status. Honor THIS result too — both writes are workflow-gated,
        // so a transition the allowlist forbids rolls the move back instead of
        // leaving status and internalStatus diverged.
        if (ok && !moved.externalSource) {
          const mirror = await setInternalStatusAction(taskId, projectKey, moved.number, newStatus);
          ok = mirror.ok;
        }
      }
      if (ok && !sameLane) {
        const res = await setTaskSwimlaneAction(taskId, newSwimlaneId);
        ok = res.ok;
      }
      // Sub-column write runs AFTER the status write, so the action validates
      // the leaf against the now-current internalStatus.
      if (ok && !sameSubColumn) {
        const res = await setTaskSubColumnAction(taskId, newSubColumnId);
        ok = res.ok;
      }
      if (!ok) {
        setTasks(prevSnapshot);
        setError(tBoard('moveError'));
        return;
      }
      router.refresh();
    });
  }

  const onRenameLane = (id: string, name: string) =>
    startTransition(async () => {
      const res = await renameBoardSwimlaneAction(id, name);
      if (res.ok) router.refresh();
      else setError(res.error.message);
    });
  const onAddLane = (name: string) =>
    startTransition(async () => {
      const res = await createBoardSwimlaneAction(projectId, name);
      if (res.ok) router.refresh();
      else setError(res.error.message);
    });

  const laneCols = (laneId: string) => (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map((col) => (
        <KanbanColumn
          key={`${laneId}-${col.status}`}
          projectKey={projectKey}
          laneKey={laneId}
          status={col.status}
          name={col.name}
          tasks={byLaneStatus.get(`${laneId}::${col.status}`) ?? []}
          cap={useCap ? COLUMN_CAP : undefined}
          wipLimit={col.wipLimit}
          subColumns={col.subColumns}
        />
      ))}
    </div>
  );

  const laneTotalOf = (laneId: string) =>
    tasks.filter((t) => (t.swimlaneId ?? NO_LANE) === laneId).length;

  const activeLane = activeLaneId ? swimlanes.find((s) => s.id === activeLaneId) ?? null : null;

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      <DndContext
        sensors={sensors}
        collisionDetection={boardCollision}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveId(null);
          setActiveLaneId(null);
        }}
      >
        {hasLanes ? (
          <div className="flex flex-col gap-5">
            {lanes.map((lane) =>
              lane.id === NO_LANE ? (
                <section key={lane.id} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-muted-foreground">{lane.name}</h3>
                    <LaneCount total={laneTotalOf(lane.id)} wipLimit={lane.wipLimit} />
                  </div>
                  {laneCols(lane.id)}
                </section>
              ) : (
                <LaneSection
                  key={lane.id}
                  laneId={lane.id}
                  name={lane.name}
                  wipLimit={lane.wipLimit}
                  laneTotal={laneTotalOf(lane.id)}
                  manageable={canManage}
                  onRename={onRenameLane}
                >
                  {laneCols(lane.id)}
                </LaneSection>
              ),
            )}
            {canManage ? <AddLaneControl onAdd={onAddLane} /> : null}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex gap-3 overflow-x-auto pb-4">
              {columns.map((col) => (
                <KanbanColumn
                  key={col.id}
                  projectKey={projectKey}
                  status={col.status}
                  name={col.name}
                  tasks={byStatus.get(col.status) ?? []}
                  cap={useCap ? COLUMN_CAP : undefined}
                  wipLimit={col.wipLimit}
                  subColumns={col.subColumns}
                />
              ))}
            </div>
            {canManage ? <AddLaneControl onAdd={onAddLane} /> : null}
          </div>
        )}
        <DragOverlay>
          {activeTask ? (
            <KanbanCard projectKey={projectKey} task={activeTask} isOverlay />
          ) : activeLane ? (
            <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-semibold shadow-lg">
              <GripVertical className="h-4 w-4 text-muted-foreground" />
              {activeLane.name}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

/** WIP/count pill shown next to a lane name. */
function LaneCount({ total, wipLimit }: { total: number; wipLimit: number | null }) {
  const over = wipLimit != null && total > wipLimit;
  return (
    <span
      className={
        'rounded-full px-2 py-0.5 text-xs tabular-nums ' +
        (over ? 'bg-red-200 text-red-900' : 'bg-muted text-muted-foreground')
      }
    >
      {wipLimit != null ? `${total}/${wipLimit}` : total}
    </span>
  );
}

/**
 * A real (configured) swimlane: a lane drop target (`lanedrop-<id>`) whose
 * header carries a drag handle (`lane-<id>`) and click-to-rename — both only
 * when `manageable`. The columns row is passed as children.
 */
function LaneSection({
  laneId,
  name,
  wipLimit,
  laneTotal,
  manageable,
  onRename,
  children,
}: {
  laneId: string;
  name: string;
  wipLimit: number | null;
  laneTotal: number;
  manageable: boolean;
  onRename: (id: string, name: string) => void;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `lanedrop-${laneId}`, data: { type: 'lane' } });
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `lane-${laneId}`,
    data: { type: 'lane' },
  });
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(name);
  useEffect(() => setVal(name), [name]);
  // Guard so one edit session dispatches exactly once: Enter→commit unmounts the
  // input, whose onBlur would otherwise fire a second commit (double round-trip).
  const committedRef = useRef(false);

  function openEditor() {
    committedRef.current = false;
    setVal(name); // always start from the current name (also resets a rejected edit)
    setEditing(true);
  }
  function commit() {
    if (committedRef.current) return;
    committedRef.current = true;
    setEditing(false);
    const v = val.trim();
    if (v && v !== name) onRename(laneId, v);
    else setVal(name);
  }
  function cancel() {
    committedRef.current = true; // suppress the unmount blur
    setVal(name);
    setEditing(false);
  }

  return (
    <section
      ref={setNodeRef}
      className={
        'flex flex-col gap-2 rounded-lg transition-colors ' +
        (isOver ? 'ring-2 ring-primary/50 ' : '') +
        (isDragging ? 'opacity-50' : '')
      }
    >
      <div className="flex items-center gap-2">
        {manageable ? (
          // Non-button (a11y): dnd-kit `attributes` already supplies role/tabIndex,
          // so a native <button>'s Space/Enter default doesn't fight the keyboard
          // drag sensor.
          <span
            ref={setDragRef}
            aria-label="Перетащить дорожку"
            className="inline-flex cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-muted active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </span>
        ) : null}
        {editing ? (
          <input
            autoFocus
            aria-label="Название дорожки"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') cancel();
            }}
            onBlur={commit}
            maxLength={60}
            className="h-7 rounded border border-input bg-background px-2 text-sm font-semibold"
          />
        ) : manageable ? (
          <button
            type="button"
            className="rounded px-1 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={openEditor}
            title="Нажмите, чтобы переименовать"
          >
            {name}
          </button>
        ) : (
          <h3 className="text-sm font-semibold text-muted-foreground">{name}</h3>
        )}
        <LaneCount total={laneTotal} wipLimit={wipLimit} />
      </div>
      {children}
    </section>
  );
}

/** "＋ дорожка" inline control: toggles to an input, creates on Enter. */
function AddLaneControl({ onAdd }: { onAdd: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState('');

  function submit() {
    const v = val.trim();
    if (v) onAdd(v);
    setVal('');
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-fit items-center gap-1 rounded-md border border-dashed border-input px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" /> дорожка
      </button>
    );
  }
  return (
    <div className="flex w-fit items-center gap-1">
      <input
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') {
            setVal('');
            setOpen(false);
          }
        }}
        maxLength={60}
        placeholder="Название дорожки"
        className="h-8 rounded-md border border-input bg-background px-2 text-sm"
      />
      <button type="button" aria-label="Создать" onClick={submit} className="rounded p-1.5 text-emerald-600 hover:bg-emerald-50">
        <Check className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Отмена"
        onClick={() => {
          setVal('');
          setOpen(false);
        }}
        className="rounded p-1.5 text-muted-foreground hover:bg-muted"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
