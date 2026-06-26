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
import { GripVertical, Plus, Check, X, Pencil } from 'lucide-react';
import type { BoardTask, BoardColumnView, BoardSwimlaneView } from '@/lib/tasks';
import { changeStatusAction } from '@/actions/tasks';
import { setInternalStatusAction } from '@/actions/assignments';
import {
  setTaskSwimlaneAction,
  setTaskSubColumnAction,
  reorderBoardSwimlanesAction,
  renameBoardSwimlaneAction,
  createBoardSwimlaneAction,
  createBoardColumnAction,
  renameBoardColumnAction,
  deleteBoardColumnAction,
  reorderBoardColumnsAction,
  setBoardColumnCategoryAction,
  setTaskColumnAction,
} from '@/actions/board';
import type { StatusCategory } from '@giper/db';
import { useT } from '@/lib/useT';
import { cn } from '@giper/ui/cn';
import { isClosing, statusCategory } from '@/lib/status/category';
import { KanbanCard } from './KanbanCard';
import { KanbanColumn } from './KanbanColumn';

type Status = BoardTask['status'];

const COLUMN_CAP = 50;
const TOTAL_THRESHOLD = 200;
/** Sentinel lane key for cards not assigned to any swimlane. */
const NO_LANE = 'none';

/**
 * S3 — resolve a card's board column id (the bucket key). Prefer the card's
 * own `columnId` when it points to a live column whose status still matches the
 * card's `internalStatus`; otherwise fall back to the 1:1 status→column map.
 * The consistency guard keeps this a pure no-op against today's 1:1 layout (a
 * stale/foreign columnId can never misplace a card) while routing placement
 * through columnId so S6's free-form columns are an incremental change.
 */
function bucketColumnId(
  t: Pick<BoardTask, 'columnId' | 'internalStatus'>,
  colById: Map<string, BoardColumnView>,
  colByStatus: Map<Status, BoardColumnView>,
): string | undefined {
  const direct = t.columnId ? colById.get(t.columnId) : undefined;
  if (direct && direct.status === t.internalStatus) return direct.id;
  return colByStatus.get(t.internalStatus)?.id;
}

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
  /** Project opted into free-form columns: address card DnD by columnId. */
  freeFormColumns?: boolean;
  /** Editor + free-form on — show the inline column-management controls. */
  canManageColumns?: boolean;
};

/** A drop target resolved from a droppable/card id: which column + which lane. */
type DropTarget = { status: Status; laneKey: string; subColumnId?: string; columnId?: string };

/**
 * Collision routing: each drag kind only sees its own droppables, so the large
 * lane/column-reorder droppables never steal a card drop and vice-versa, and the
 * existing card DnD behaves exactly as before. Three kinds:
 *   - lane reorder    (active.data.type==='lane')    → lane droppables only
 *   - column reorder  (active.data.type==='colhead') → column-head droppables only
 *   - card move       (anything else)                → all the rest
 */
const boardCollision: CollisionDetection = (args) => {
  const kind = args.active.data.current?.type;
  if (kind === 'lane' || kind === 'colhead') {
    const droppableContainers = args.droppableContainers.filter(
      (c) => c.data.current?.type === kind,
    );
    return closestCenter({ ...args, droppableContainers });
  }
  const droppableContainers = args.droppableContainers.filter((c) => {
    const t = c.data.current?.type;
    return t !== 'lane' && t !== 'colhead';
  });
  return rectIntersection({ ...args, droppableContainers });
};

export function KanbanBoard({
  projectKey,
  projectId,
  initialTasks,
  columns,
  swimlanes = [],
  canManage = false,
  freeFormColumns = false,
  canManageColumns = false,
}: Props) {
  const router = useRouter();
  const tBoard = useT('tasks.board');

  const [tasks, setTasks] = useState<BoardTask[]>(initialTasks);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeLaneId, setActiveLaneId] = useState<string | null>(null);
  const [activeColumnId, setActiveColumnId] = useState<string | null>(null);
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

  // Column lookups: by id (the placement bucket key) and by status (the 1:1
  // fallback + the status-keyed DnD/render paths). Column↔status is 1:1 today,
  // so the status map resolves every card to exactly one column.
  const colById = useMemo(
    () => new Map(columns.map((c) => [c.id, c])),
    [columns],
  );
  const colByStatus = useMemo(() => {
    const m = new Map<Status, BoardColumnView>();
    for (const c of columns) if (!m.has(c.status)) m.set(c.status, c);
    return m;
  }, [columns]);

  // Column totals (across all lanes) — drives the single-lane view and the
  // per-column WIP check, which is board-wide regardless of swimlanes. Keyed by
  // column id now (S3): cards route through their columnId, not internalStatus.
  const byColumn = useMemo(() => {
    const map = new Map<string, BoardTask[]>();
    for (const c of columns) map.set(c.id, []);
    for (const t of tasks) {
      const cid = bucketColumnId(t, colById, colByStatus);
      const arr = cid ? map.get(cid) : undefined;
      if (arr) arr.push(t);
    }
    return map;
  }, [tasks, columns, colById, colByStatus]);

  // Tasks bucketed by `${laneKey}::${columnId}` for the band view.
  const byLaneColumn = useMemo(() => {
    const map = new Map<string, BoardTask[]>();
    for (const t of tasks) {
      const cid = bucketColumnId(t, colById, colByStatus);
      if (!cid) continue;
      const key = `${t.swimlaneId ?? NO_LANE}::${cid}`;
      const arr = map.get(key);
      if (arr) arr.push(t);
      else map.set(key, [t]);
    }
    return map;
  }, [tasks, colById, colByStatus]);

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
    // Band droppable: `cell-<laneKey>-<KEY>` where KEY is the columnId (free-form)
    // or the STATUS (default). Neither cuid nor STATUS contains a dash → split on
    // the last dash.
    if (id.startsWith('cell-')) {
      const rest = id.slice('cell-'.length);
      const idx = rest.lastIndexOf('-');
      if (idx === -1) return null;
      const laneKey = rest.slice(0, idx);
      const key = rest.slice(idx + 1);
      if (freeFormColumns) {
        const col = colById.get(key);
        return col ? { laneKey, status: col.status, columnId: col.id } : null;
      }
      return { laneKey, status: key as Status };
    }
    // Single-lane droppable: `column-<KEY>` (columnId in free-form, else STATUS).
    if (id.startsWith('column-')) {
      const key = id.slice('column-'.length);
      if (freeFormColumns) {
        const col = colById.get(key);
        return col ? { laneKey: NO_LANE, status: col.status, columnId: col.id } : null;
      }
      return { laneKey: NO_LANE, status: key as Status };
    }
    const t = tasks.find((tt) => tt.id === id);
    if (!t) return null;
    return {
      laneKey: t.swimlaneId ?? NO_LANE,
      status: t.internalStatus,
      subColumnId: t.subColumnId ?? undefined,
      columnId: freeFormColumns ? bucketColumnId(t, colById, colByStatus) : undefined,
    };
  }

  function handleDragStart(e: DragStartEvent) {
    setError(null);
    if (e.active.data.current?.type === 'lane') {
      setActiveLaneId(String(e.active.id).replace(/^lane-/, ''));
      return;
    }
    if (e.active.data.current?.type === 'colhead') {
      setActiveColumnId(String(e.active.id).replace(/^colhead-/, ''));
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

    // Column reorder — drag a free-form column head onto another (routed by
    // boardCollision to `colhead` droppables only). Mirrors the ←/→ buttons'
    // reorderBoardColumnsAction; refreshes from the server (no optimistic state,
    // since `columns` is a prop).
    if (active.data.current?.type === 'colhead') {
      setActiveColumnId(null);
      if (!over) return;
      const fromId = String(active.id).replace(/^colhead-/, '');
      const overId = String(over.id);
      const toId = overId.startsWith('coldrop-')
        ? overId.slice('coldrop-'.length)
        : overId.replace(/^colhead-/, '');
      if (!toId || toId === fromId) return;
      const ids = columns.map((c) => c.id);
      const fromIdx = ids.indexOf(fromId);
      const toIdx = ids.indexOf(toId);
      if (fromIdx < 0 || toIdx < 0) return;
      const next = arrayMove(ids, fromIdx, toIdx);
      startTransition(async () => {
        const res = await reorderBoardColumnsAction(projectId, next);
        if (res.ok) router.refresh();
        else setError(res.error.message);
      });
      return;
    }

    setActiveId(null);
    if (!over) return;

    const from = findTarget(String(active.id));
    const to = findTarget(String(over.id));
    if (!from || !to) return;

    const taskId = String(active.id);

    // Free-form boards route card moves by columnId (a status can back many
    // columns); default boards fall through to the status-based path below,
    // unchanged.
    if (freeFormColumns) {
      handleFreeFormMove(taskId, from, to, String(over.id));
      return;
    }

    const sameStatus = from.status === to.status;
    const sameLane = from.laneKey === to.laneKey;
    const sameSubColumn = (from.subColumnId ?? null) === (to.subColumnId ?? null);

    if (sameStatus && sameLane && sameSubColumn) {
      // Reorder within the same cell — local only, not persisted. Resolve the
      // cell's column id from its (1:1) status to read the right bucket.
      const fromColId = colByStatus.get(from.status)?.id;
      const arr =
        (hasLanes
          ? byLaneColumn.get(`${from.laneKey}::${fromColId}`)
          : fromColId
            ? byColumn.get(fromColId)
            : undefined) ?? [];
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
      const targetCount =
        (targetCol ? byColumn.get(targetCol.id) : undefined)?.length ?? 0;
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
    if (!sameStatus && isClosing(statusCategory(newStatus))) {
      setError('Чтобы закрыть задачу, откройте её и укажите итог при закрытии.');
      return;
    }

    // Optimistic: update internalStatus + swimlaneId on the moved card. Mirror
    // `status` is owned by Bitrix and only updated by the sync round-trip. Keep
    // `columnId` in sync too (S3 placement source): a status change retargets
    // the card to that status's column; a lane/sub-column-only move leaves it.
    const newColumnId = sameStatus
      ? moved.columnId ?? null
      : colByStatus.get(newStatus)?.id ?? null;
    setTasks((cur) =>
      cur.map((t) =>
        t.id === taskId
          ? {
              ...t,
              internalStatus: newStatus,
              columnId: newColumnId,
              swimlaneId: newSwimlaneId,
              subColumnId: newSubColumnId,
            }
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

  // --- Free-form column management (S6) ----------------------------------
  const onAddColumn = (name: string, category: StatusCategory) =>
    startTransition(async () => {
      const res = await createBoardColumnAction(projectId, name, category);
      if (res.ok) router.refresh();
      else setError(res.error.message);
    });
  const onRenameColumn = (columnId: string, name: string) =>
    startTransition(async () => {
      const res = await renameBoardColumnAction(columnId, name);
      if (res.ok) router.refresh();
      else setError(res.error.message);
    });
  const onDeleteColumn = (columnId: string) =>
    startTransition(async () => {
      const res = await deleteBoardColumnAction(columnId);
      if (res.ok) router.refresh();
      else setError(res.error.message);
    });
  const onMoveColumn = (columnId: string, dir: -1 | 1) =>
    startTransition(async () => {
      const ids = columns.map((c) => c.id);
      const i = ids.indexOf(columnId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ids.length) return;
      const res = await reorderBoardColumnsAction(projectId, arrayMove(ids, i, j));
      if (res.ok) router.refresh();
      else setError(res.error.message);
    });
  const onSetColumnCategory = (columnId: string, category: StatusCategory) =>
    startTransition(async () => {
      const res = await setBoardColumnCategoryAction(columnId, category);
      if (res.ok) router.refresh();
      else setError(res.error.message);
    });

  /** Card move on a free-form board — routed by columnId via setTaskColumnAction. */
  function handleFreeFormMove(taskId: string, from: DropTarget, to: DropTarget, overId: string) {
    if (!to.columnId) return;
    const toCol = colById.get(to.columnId);
    if (!toCol) return;
    const sameColumn = from.columnId != null && from.columnId === to.columnId;
    const sameLane = from.laneKey === to.laneKey;

    // Reorder within the same cell — local only (not persisted).
    if (sameColumn && sameLane) {
      const arr =
        (hasLanes
          ? byLaneColumn.get(`${from.laneKey}::${to.columnId}`)
          : byColumn.get(to.columnId)) ?? [];
      const oldIndex = arr.findIndex((t) => t.id === taskId);
      const newIndex = arr.findIndex((t) => t.id === overId);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
      const reordered = arrayMove(arr, oldIndex, newIndex);
      const inCell = new Set(arr.map((t) => t.id));
      setTasks([...tasks.filter((t) => !inCell.has(t.id)), ...reordered]);
      return;
    }

    const moved = tasks.find((t) => t.id === taskId);
    if (!moved) return;
    const newSwimlaneId = to.laneKey === NO_LANE ? null : to.laneKey;

    // Closing needs an итог (can't collect mid-drag) — block drag into a DONE-
    // category column; the user closes from the card.
    if (
      !sameColumn &&
      toCol.status !== moved.internalStatus &&
      isClosing(statusCategory(toCol.status))
    ) {
      setError('Чтобы закрыть задачу, откройте её и укажите итог при закрытии.');
      return;
    }
    if (!sameColumn) {
      const targetCount = (byColumn.get(toCol.id) ?? []).length;
      if (toCol.wipLimit != null && targetCount >= toCol.wipLimit) {
        setError(`Колонка «${toCol.name}» заполнена (WIP-лимит ${toCol.wipLimit}).`);
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

    setTasks((cur) =>
      cur.map((t) =>
        t.id === taskId
          ? { ...t, columnId: toCol.id, internalStatus: toCol.status, swimlaneId: newSwimlaneId }
          : t,
      ),
    );
    startTransition(async () => {
      let ok = true;
      if (!sameColumn) {
        const res = await setTaskColumnAction(taskId, toCol.id);
        if (!res.ok) setError(res.error.message);
        ok = res.ok;
      }
      if (ok && !sameLane) {
        const res = await setTaskSwimlaneAction(taskId, newSwimlaneId);
        ok = res.ok;
      }
      if (!ok) {
        // A column write may have already committed (partial move) — re-read the
        // authoritative server state rather than reverting to a stale snapshot,
        // and always surface feedback.
        setError(tBoard('moveError'));
        router.refresh();
        return;
      }
      router.refresh();
    });
  }

  const laneCols = (laneId: string) => (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map((col) => (
        <KanbanColumn
          key={`${laneId}-${col.id}`}
          projectKey={projectKey}
          laneKey={laneId}
          status={col.status}
          name={col.name}
          columnId={col.id}
          useColumnId={freeFormColumns}
          tasks={byLaneColumn.get(`${laneId}::${col.id}`) ?? []}
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
  const activeColumn = activeColumnId ? columns.find((c) => c.id === activeColumnId) ?? null : null;

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
          setActiveColumnId(null);
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
              {columns.map((col, i) => {
                const column = (dragHandle?: React.ReactNode) => (
                  <KanbanColumn
                    projectKey={projectKey}
                    status={col.status}
                    name={col.name}
                    columnId={col.id}
                    useColumnId={freeFormColumns}
                    canManageColumns={canManageColumns}
                    onRenameColumn={onRenameColumn}
                    onDeleteColumn={onDeleteColumn}
                    onMoveColumn={onMoveColumn}
                    onSetColumnCategory={onSetColumnCategory}
                    dragHandle={dragHandle}
                    isFirstColumn={i === 0}
                    isLastColumn={i === columns.length - 1}
                    tasks={byColumn.get(col.id) ?? []}
                    cap={useCap ? COLUMN_CAP : undefined}
                    wipLimit={col.wipLimit}
                    subColumns={col.subColumns}
                  />
                );
                // Free-form + manageable: wrap in a drag shell so the column can be
                // dragged to reorder (in addition to the ←/→ buttons). Otherwise
                // render the column directly — the non-free-form path is unchanged.
                return canManageColumns && freeFormColumns ? (
                  <ColumnDragShell key={col.id} columnId={col.id}>
                    {column}
                  </ColumnDragShell>
                ) : (
                  <div key={col.id} className="shrink-0">
                    {column()}
                  </div>
                );
              })}
              {canManageColumns ? <AddColumnControl onAdd={onAddColumn} /> : null}
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
          ) : activeColumn ? (
            <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-semibold shadow-lg">
              <GripVertical className="h-4 w-4 text-muted-foreground" />
              {activeColumn.name}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

/**
 * Wraps a free-form column so it can be dragged to reorder (in addition to the
 * ←/→ buttons). Owns the column-reorder droppable (`coldrop-<id>`, type
 * `colhead`) and supplies a drag handle (`colhead-<id>`) the column renders in
 * its header. The distinct `colhead` type keeps card and lane DnD untouched
 * (see boardCollision).
 */
function ColumnDragShell({
  columnId,
  children,
}: {
  columnId: string;
  children: (dragHandle: ReactNode) => ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `coldrop-${columnId}`, data: { type: 'colhead' } });
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({ id: `colhead-${columnId}`, data: { type: 'colhead' } });
  const handle = (
    <button
      ref={setDragRef}
      type="button"
      {...attributes}
      {...listeners}
      className="shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-muted active:cursor-grabbing"
      title="Перетащить колонку"
      aria-label="Перетащить колонку"
    >
      <GripVertical className="h-3.5 w-3.5" />
    </button>
  );
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'shrink-0 rounded-md',
        isDragging ? 'opacity-50' : '',
        isOver ? 'ring-2 ring-primary/40' : '',
      )}
    >
      {children(handle)}
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
        ) : (
          <>
            {/* Stays a real heading (semantic + relied on by e2e); rename is a
                separate keyboard-accessible pencil button. */}
            <h3 className="text-sm font-semibold text-muted-foreground">{name}</h3>
            {manageable ? (
              <button
                type="button"
                aria-label="Переименовать дорожку"
                title="Переименовать"
                onClick={openEditor}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </>
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

/** Russian labels for the status categories a free-form column can belong to. */
const CATEGORY_LABELS: Record<StatusCategory, string> = {
  BACKLOG: 'Бэклог',
  TODO: 'К выполнению',
  IN_PROGRESS: 'В работе',
  REVIEW: 'На проверке',
  BLOCKED: 'Заблокировано',
  DONE: 'Готово',
  CANCELED: 'Отменено',
};

/**
 * Categories offerable for a NEW column. Terminal ones are excluded: a CANCELED
 * column is filtered out by the board loader (would be an invisible orphan), and
 * a second DONE column is unreachable (drag-in needs an итог + close routes to
 * the first DONE). The materialized default DONE column handles closing.
 */
const PICKABLE_CATEGORIES: StatusCategory[] = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'BLOCKED'];

/** ＋ a free-form board column: a name + a status category (drives done-detection). */
function AddColumnControl({ onAdd }: { onAdd: (name: string, category: StatusCategory) => void }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState('');
  const [cat, setCat] = useState<StatusCategory>('IN_PROGRESS');

  function submit() {
    const v = val.trim();
    if (v) onAdd(v, cat);
    setVal('');
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-fit w-44 shrink-0 items-center justify-center gap-1 self-start rounded-md border-2 border-dashed border-input px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
      >
        <Plus className="h-4 w-4" /> колонка
      </button>
    );
  }
  return (
    <div className="flex w-56 shrink-0 flex-col gap-2 self-start rounded-md border-2 border-dashed border-input p-2">
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
        placeholder="Название колонки"
        className="h-8 rounded-md border border-input bg-background px-2 text-sm"
      />
      <select
        value={cat}
        onChange={(e) => setCat(e.target.value as StatusCategory)}
        className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        title="Категория статуса (определяет логику завершения)"
      >
        {PICKABLE_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {CATEGORY_LABELS[c]}
          </option>
        ))}
      </select>
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          aria-label="Создать"
          onClick={submit}
          className="rounded p-1.5 text-emerald-600 hover:bg-emerald-50"
        >
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
    </div>
  );
}
