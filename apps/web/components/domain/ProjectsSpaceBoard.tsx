'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import { Card } from '@giper/ui/components/Card';
import { Avatar } from '@giper/ui/components/Avatar';
import { setProjectSpaceAction } from '@/actions/spaces';

/** Mirrors StatusBadge colors — inlined so this client island needs no i18n
 *  provider context (the label is pre-translated server-side). */
const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  ON_HOLD: 'bg-amber-100 text-amber-700',
  COMPLETED: 'bg-sky-100 text-sky-700',
  ARCHIVED: 'bg-neutral-200 text-neutral-700',
};

export type SpaceBoardProject = {
  id: string;
  key: string;
  name: string;
  status: string;
  /** Pre-translated status label (computed server-side). */
  statusLabel: string;
  owner: { name: string; image: string | null };
  members: number;
  tasks: number;
  deadline: string | null;
};

export type SpaceBoardGroup = {
  /** Space id, or null for the "Без пространства" bucket. */
  spaceId: string | null;
  name: string;
  projects: SpaceBoardProject[];
};

const NONE = '__none__';
const keyOf = (spaceId: string | null) => spaceId ?? NONE;
const TH = 'px-4 py-2 font-medium';

type Props = { groups: SpaceBoardGroup[]; labels: Record<string, string> };

/**
 * Projects grouped by Space, with drag-to-move between groups. Dropping a
 * project onto a different group calls setProjectSpaceAction (which re-checks
 * edit permission server-side); a rejected move rolls back. Rows use
 * useDraggable WITHOUT a layout transform (a DragOverlay chip is the visual),
 * so the table layout never glitches mid-drag.
 */
export function ProjectsSpaceBoard({ groups: initial, labels }: Props) {
  const router = useRouter();
  const [groups, setGroups] = useState(initial);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const initialKey = initial.map((g) => `${keyOf(g.spaceId)}:${g.projects.map((p) => p.id).join('.')}`).join('|');
  useEffect(() => setGroups(initial), [initialKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const active = activeId
    ? groups.flatMap((g) => g.projects).find((p) => p.id === activeId) ?? null
    : null;

  function onDragStart(e: DragStartEvent) {
    setError(null);
    setActiveId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active: a, over } = e;
    if (!over) return;
    const projectId = String(a.id);
    const fromKey = String(a.data.current?.fromKey ?? '');
    const toKey = String(over.id);
    if (!toKey || fromKey === toKey) return;

    const source = groups.find((g) => keyOf(g.spaceId) === fromKey);
    const target = groups.find((g) => keyOf(g.spaceId) === toKey);
    const moved = source?.projects.find((p) => p.id === projectId);
    if (!source || !target || !moved) return;

    const prev = groups;
    // Optimistic move. Prepend to the target: setProjectSpaceAction bumps the
    // project's updatedAt and listProjectsForUser orders by updatedAt desc, so
    // the row lands at the TOP after router.refresh — prepending matches that
    // final position and avoids a one-frame reposition.
    setGroups((gs) =>
      gs.map((g) => {
        if (keyOf(g.spaceId) === fromKey) return { ...g, projects: g.projects.filter((p) => p.id !== projectId) };
        if (keyOf(g.spaceId) === toKey) return { ...g, projects: [moved, ...g.projects] };
        return g;
      }),
    );

    startTransition(async () => {
      const res = await setProjectSpaceAction(moved.key, target.spaceId);
      if (res.ok) router.refresh();
      else {
        setGroups(prev); // roll back
        setError(res.error?.message ?? 'Не удалось переместить проект');
      }
    });
  }

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="space-y-4">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {groups.map((g) => (
          <DroppableGroup key={keyOf(g.spaceId)} group={g} labels={labels} />
        ))}
      </div>
      <DragOverlay>
        {active ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm shadow-lg">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono text-xs">{active.key}</span>
            <span className="truncate">{active.name}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function DroppableGroup({ group, labels }: { group: SpaceBoardGroup; labels: Record<string, string> }) {
  const { setNodeRef, isOver } = useDroppable({ id: keyOf(group.spaceId) });
  return (
    <div className="space-y-1.5">
      <h2 className="text-sm font-medium text-muted-foreground">{group.name}</h2>
      <Card
        ref={setNodeRef}
        className={`overflow-hidden transition-colors ${isOver ? 'ring-2 ring-primary/60' : ''}`}
      >
        <div className="-mx-px overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-8 px-2 py-2" />
                <th className={TH}>{labels.key}</th>
                <th className={TH}>{labels.name}</th>
                <th className={TH}>{labels.status}</th>
                <th className={TH}>{labels.owner}</th>
                <th className={TH}>{labels.members}</th>
                <th className={TH}>{labels.tasks}</th>
                <th className={TH}>{labels.deadline}</th>
              </tr>
            </thead>
            <tbody>
              {group.projects.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-xs text-muted-foreground">
                    Перетащите проект сюда
                  </td>
                </tr>
              ) : (
                group.projects.map((p) => (
                  <DraggableRow key={p.id} project={p} fromKey={keyOf(group.spaceId)} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function DraggableRow({ project: p, fromKey }: { project: SpaceBoardProject; fromKey: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: p.id,
    data: { fromKey },
  });
  return (
    <tr ref={setNodeRef} className={`border-t border-border hover:bg-muted/30 ${isDragging ? 'opacity-40' : ''}`}>
      <td className="px-2 py-2">
        <button
          type="button"
          aria-label={`Перетащить проект ${p.key}`}
          className="cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-muted active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </td>
      <td className="px-4 py-2 font-mono text-xs">
        <Link href={`/projects/${p.key}`} className="hover:underline">{p.key}</Link>
      </td>
      <td className="px-4 py-2">
        <Link href={`/projects/${p.key}`} className="hover:underline">{p.name}</Link>
      </td>
      <td className="px-4 py-2">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            STATUS_COLORS[p.status] ?? 'bg-neutral-200 text-neutral-700'
          }`}
        >
          {p.statusLabel}
        </span>
      </td>
      <td className="px-4 py-2">
        <span className="inline-flex items-center gap-2">
          <Avatar src={p.owner.image} alt={p.owner.name} className="h-6 w-6" />
          <span className="text-muted-foreground">{p.owner.name}</span>
        </span>
      </td>
      <td className="px-4 py-2 text-muted-foreground">{p.members}</td>
      <td className="px-4 py-2 text-muted-foreground">{p.tasks}</td>
      <td className="px-4 py-2 text-muted-foreground">
        {p.deadline ? new Date(p.deadline).toLocaleDateString('ru-RU') : '—'}
      </td>
    </tr>
  );
}
