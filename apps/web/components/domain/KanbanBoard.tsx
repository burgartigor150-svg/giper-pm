'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable';
import type { BoardTask, BoardColumnView, BoardSwimlaneView } from '@/lib/tasks';
import { changeStatusAction } from '@/actions/tasks';
import { setInternalStatusAction } from '@/actions/assignments';
import { setTaskSwimlaneAction, setTaskSubColumnAction } from '@/actions/board';
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
  initialTasks: BoardTask[];
  /** Columns in display order (first-class rows or synthesized defaults). */
  columns: BoardColumnView[];
  /** Swimlanes in display order. Empty → single implicit lane (today's view). */
  swimlanes?: BoardSwimlaneView[];
};

/** A drop target resolved from a droppable/card id: which column + which lane. */
type DropTarget = { status: Status; laneKey: string; subColumnId?: string };

export function KanbanBoard({
  projectKey,
  initialTasks,
  columns,
  swimlanes = [],
}: Props) {
  const router = useRouter();
  const tBoard = useT('tasks.board');

  const [tasks, setTasks] = useState<BoardTask[]>(initialTasks);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

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

  // Band rows: the implicit "no lane" first, then the configured swimlanes.
  const lanes = useMemo(
    () => [
      { id: NO_LANE, name: 'Без дорожки', wipLimit: null as number | null },
      ...swimlanes.map((s) => ({ id: s.id, name: s.name, wipLimit: s.wipLimit })),
    ],
    [swimlanes],
  );

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
    setActiveId(String(e.active.id));
    setError(null);
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
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
        // Belt and braces: keep internalStatus in sync for legacy tasks too.
        if (res.ok && !moved.externalSource) {
          await setInternalStatusAction(taskId, projectKey, moved.number, newStatus);
        }
        ok = res.ok;
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

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        {hasLanes ? (
          <div className="flex flex-col gap-5">
            {lanes.map((lane) => {
              const laneTotal = tasks.filter(
                (t) => (t.swimlaneId ?? NO_LANE) === lane.id,
              ).length;
              const laneOver = lane.wipLimit != null && laneTotal > lane.wipLimit;
              return (
                <section key={lane.id} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-muted-foreground">
                      {lane.name}
                    </h3>
                    <span
                      className={
                        'rounded-full px-2 py-0.5 text-xs tabular-nums ' +
                        (laneOver
                          ? 'bg-red-200 text-red-900'
                          : 'bg-muted text-muted-foreground')
                      }
                    >
                      {lane.wipLimit != null ? `${laneTotal}/${lane.wipLimit}` : laneTotal}
                    </span>
                  </div>
                  <div className="flex gap-3 overflow-x-auto pb-2">
                    {columns.map((col) => (
                      <KanbanColumn
                        key={`${lane.id}-${col.status}`}
                        projectKey={projectKey}
                        laneKey={lane.id}
                        status={col.status}
                        name={col.name}
                        tasks={byLaneStatus.get(`${lane.id}::${col.status}`) ?? []}
                        cap={useCap ? COLUMN_CAP : undefined}
                        wipLimit={col.wipLimit}
                        subColumns={col.subColumns}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
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
        )}
        <DragOverlay>
          {activeTask ? (
            <KanbanCard projectKey={projectKey} task={activeTask} isOverlay />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
