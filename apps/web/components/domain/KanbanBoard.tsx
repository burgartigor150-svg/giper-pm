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
import type { BoardTask } from '@/lib/tasks';
import { changeStatusAction } from '@/actions/tasks';
import { setInternalStatusAction } from '@/actions/assignments';
import { useT } from '@/lib/useT';
import { KanbanCard } from './KanbanCard';
import { KanbanColumn } from './KanbanColumn';

type Status = BoardTask['status'];

const COLUMNS: Exclude<Status, 'CANCELED'>[] = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'REVIEW',
  'BLOCKED',
  'DONE',
];

const COLUMN_CAP = 50;
const TOTAL_THRESHOLD = 200;

type Props = {
  projectKey: string;
  initialTasks: BoardTask[];
  /** Per-status WIP limits. Missing keys = no limit. */
  wipLimits?: Partial<Record<Status, number>> | null;
};

export function KanbanBoard({ projectKey, initialTasks, wipLimits }: Props) {
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

  // Bucket tasks by *internal* status — board reflects the team's
  // track. For non-mirrored tasks internalStatus equals status (the
  // migration backfilled it), so this doesn't change anything for
  // those. For Bitrix-mirrored tasks the board now shows where our
  // team is on each task, independent of what the client sees in
  // Bitrix.
  const byStatus = useMemo(() => {
    const map = new Map<Status, BoardTask[]>();
    for (const c of COLUMNS) map.set(c, []);
    for (const t of tasks) {
      const arr = map.get(t.internalStatus);
      if (arr) arr.push(t);
    }
    return map;
  }, [tasks]);

  const useCap = tasks.length > TOTAL_THRESHOLD;
  const activeTask = activeId ? tasks.find((t) => t.id === activeId) ?? null : null;

  function findContainer(id: string): Status | null {
    if (id.startsWith('column-')) return id.slice('column-'.length) as Status;
    const t = tasks.find((tt) => tt.id === id);
    return t ? t.internalStatus : null;
  }

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    setError(null);
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;

    const activeContainer = findContainer(String(active.id));
    const overContainer = findContainer(String(over.id));
    if (!activeContainer || !overContainer) return;

    const taskId = String(active.id);

    if (activeContainer === overContainer) {
      // Reorder within column (local only, not persisted).
      const arr = byStatus.get(activeContainer) ?? [];
      const oldIndex = arr.findIndex((t) => t.id === active.id);
      const newIndex = arr.findIndex((t) => t.id === over.id);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

      const reordered = arrayMove(arr, oldIndex, newIndex);
      const others = tasks.filter((t) => t.internalStatus !== activeContainer);
      setTasks([...others, ...reordered]);
      return;
    }

    // Moved to another column → persist via server action.
    const prevSnapshot = tasks;
    const newStatus = overContainer;

    // Optimistic state mutation — update internalStatus on the moved
    // card. Mirror status (`status`) is untouched; that's owned by
    // Bitrix and updated only by the sync round-trip.
    setTasks((cur) =>
      cur.map((t) => (t.id === taskId ? { ...t, internalStatus: newStatus } : t)),
    );

    const moved = prevSnapshot.find((t) => t.id === taskId);
    if (!moved) return;

    startTransition(async () => {
      // For mirrored tasks the kanban writes only to the internal
      // track. For non-mirrored tasks we ALSO update the legacy
      // `status` so existing time-tracking lifecycle (startedAt /
      // completedAt) keeps working — those still key off `status`.
      const res = moved.externalSource
        ? await setInternalStatusAction(taskId, projectKey, moved.number, newStatus)
        : await changeStatusAction(taskId, projectKey, moved.number, newStatus);
      // Belt and braces: also keep internalStatus in sync for legacy
      // tasks (changeStatusAction doesn't touch it).
      if (res.ok && !moved.externalSource) {
        await setInternalStatusAction(taskId, projectKey, moved.number, newStatus);
      }
      if (!res.ok) {
        // Roll back to prev snapshot.
        setTasks(prevSnapshot);
        setError(tBoard('moveError'));
        return;
      }
      // Pull server truth back to overwrite local state (including timestamps).
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
        <div className="flex gap-3 overflow-x-auto pb-4">
          {COLUMNS.map((status) => (
            <KanbanColumn
              key={status}
              projectKey={projectKey}
              status={status}
              tasks={byStatus.get(status) ?? []}
              cap={useCap ? COLUMN_CAP : undefined}
              wipLimit={wipLimits?.[status] ?? null}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask ? (
            <KanbanCard projectKey={projectKey} task={activeTask} isOverlay />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
