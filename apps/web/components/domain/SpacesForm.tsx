'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronUp, ChevronDown, GripVertical, Trash2, Plus, Check } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import {
  createSpaceAction,
  renameSpaceAction,
  deleteSpaceAction,
  reorderSpacesAction,
} from '@/actions/spaces';
import type { SpaceView } from '@/lib/spaces/getSpaces';

type Props = { initial: SpaceView[]; canManage: boolean };

export function SpacesForm({ initial, canManage }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  // Local editable names keyed by id.
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(initial.map((s) => [s.id, s.name])),
  );
  // Local display order (optimistic). Re-synced whenever the server set changes
  // (add/delete/reorder all flow back through router.refresh → new `initial`).
  const initialKey = initial.map((s) => s.id).join(',');
  const [orderIds, setOrderIds] = useState<string[]>(() => initial.map((s) => s.id));
  useEffect(() => {
    setOrderIds(initial.map((s) => s.id));
    setNames(Object.fromEntries(initial.map((s) => [s.id, s.name])));
  }, [initialKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = new Map(initial.map((s) => [s.id, s]));
  const ordered = orderIds.map((id) => byId.get(id)).filter((s): s is SpaceView => Boolean(s));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function run(fn: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) router.refresh();
      else setError(res.error?.message ?? 'Ошибка');
    });
  }

  function create() {
    if (newName.trim().length < 2) {
      setError('Название ≥ 2 символов');
      return;
    }
    run(async () => {
      const res = await createSpaceAction(newName.trim());
      if (res.ok) setNewName('');
      return res;
    });
  }

  function commitOrder(ids: string[]) {
    setOrderIds(ids); // optimistic
    run(() => reorderSpacesAction(ids));
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= ordered.length) return;
    commitOrder(arrayMove(orderIds, i, j));
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = orderIds.indexOf(String(active.id));
    const to = orderIds.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    commitOrder(arrayMove(orderIds, from, to));
  }

  if (!canManage) {
    return (
      <p className="text-sm text-muted-foreground">
        {initial.length > 0
          ? `Пространств: ${initial.length}. Управление — у ADMIN/PM.`
          : 'Пространств пока нет.'}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Пространства — папки для группировки проектов. Перетащите за{' '}
        <GripVertical className="inline h-3.5 w-3.5 align-text-bottom" />, чтобы изменить порядок.
        Проект кладётся в пространство перетаскиванием на странице проектов. Видимость не меняется.
      </p>
      {ordered.length > 0 ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={orderIds} strategy={verticalListSortingStrategy}>
            <ul className="flex flex-col gap-2">
              {ordered.map((s, i) => (
                <SpaceRow
                  key={s.id}
                  space={s}
                  index={i}
                  total={ordered.length}
                  name={names[s.id] ?? ''}
                  pending={pending}
                  onName={(v) => setNames((n) => ({ ...n, [s.id]: v }))}
                  onMove={move}
                  onRename={() => run(() => renameSpaceAction(s.id, names[s.id] ?? s.name, s.description ?? ''))}
                  onDelete={() => {
                    if (confirm('Удалить пространство? Его проекты станут без пространства (не удалятся).'))
                      run(() => deleteSpaceAction(s.id));
                  }}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : (
        <p className="text-sm text-muted-foreground">Пространств пока нет.</p>
      )}
      <div className="flex items-center gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          disabled={pending}
          maxLength={120}
          placeholder="Новое пространство"
          className="h-9 min-w-[10rem] flex-1 rounded-md border border-input bg-background px-2 text-sm"
        />
        <Button type="button" size="sm" onClick={create} disabled={pending || newName.trim() === ''}>
          <Plus className="mr-1 h-4 w-4" />
          {pending ? '…' : 'Создать'}
        </Button>
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </div>
    </div>
  );
}

type RowProps = {
  space: SpaceView;
  index: number;
  total: number;
  name: string;
  pending: boolean;
  onName: (v: string) => void;
  onMove: (i: number, dir: -1 | 1) => void;
  onRename: () => void;
  onDelete: () => void;
};

function SpaceRow({ space, index, total, name, pending, onName, onMove, onRename, onDelete }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: space.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex flex-wrap items-center gap-2 rounded-md border border-input bg-background p-2"
    >
      <button
        type="button"
        aria-label="Перетащить"
        className="shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-muted active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex shrink-0 flex-col">
        <button type="button" aria-label="Выше" onClick={() => onMove(index, -1)} disabled={pending || index === 0}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30">
          <ChevronUp className="h-4 w-4" />
        </button>
        <button type="button" aria-label="Ниже" onClick={() => onMove(index, 1)} disabled={pending || index === total - 1}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30">
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
      <input
        value={name}
        onChange={(e) => onName(e.target.value)}
        disabled={pending}
        maxLength={120}
        className="h-9 min-w-[8rem] flex-1 rounded-md border border-input bg-background px-2 text-sm"
      />
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{space.projectCount} пр.</span>
      <button type="button" aria-label="Сохранить название" title="Сохранить" onClick={onRename} disabled={pending}
        className="shrink-0 rounded p-1.5 text-emerald-600 hover:bg-emerald-50 disabled:opacity-50">
        <Check className="h-4 w-4" />
      </button>
      <button type="button" aria-label="Удалить пространство" title="Удалить (проекты разгруппируются)" onClick={onDelete} disabled={pending}
        className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50">
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}
