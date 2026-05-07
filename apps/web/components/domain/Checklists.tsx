'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Plus, Trash2 } from 'lucide-react';
import {
  addChecklistItemAction,
  createChecklistAction,
  deleteChecklistAction,
  deleteChecklistItemAction,
  renameChecklistAction,
  toggleChecklistItemAction,
} from '@/actions/checklists';

type Item = {
  id: string;
  body: string;
  isDone: boolean;
  order: number;
};

type Checklist = {
  id: string;
  title: string;
  order: number;
  items: Item[];
};

type Props = {
  taskId: string;
  projectKey: string;
  taskNumber: number;
  checklists: Checklist[];
  /** Anyone with edit rights on the task can add/rename/delete checklists. */
  canEdit: boolean;
};

/**
 * Multi-checklist block on the task detail page. Each checklist:
 *   - Title (renames inline if canEdit)
 *   - Progress bar (X/N done)
 *   - List of items with checkbox, inline-delete (canEdit only)
 *   - Inline "+ add item" input
 *
 * Toggling an item is a softer permission than editing — any task viewer
 * can tick a box (typical: QA ticks DoD items without being a project
 * member). Mutating structure (add/rename/delete) requires canEdit.
 */
export function Checklists({ taskId, projectKey, taskNumber, checklists, canEdit }: Props) {
  return (
    <div className="flex flex-col gap-5">
      {checklists.map((c) => (
        <ChecklistBlock
          key={c.id}
          checklist={c}
          projectKey={projectKey}
          taskNumber={taskNumber}
          canEdit={canEdit}
        />
      ))}
      {canEdit ? (
        <NewChecklistButton
          taskId={taskId}
          projectKey={projectKey}
          taskNumber={taskNumber}
        />
      ) : null}
    </div>
  );
}

function ChecklistBlock({
  checklist,
  projectKey,
  taskNumber,
  canEdit,
}: {
  checklist: Checklist;
  projectKey: string;
  taskNumber: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(checklist.title);

  const total = checklist.items.length;
  const done = checklist.items.filter((i) => i.isDone).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  function saveTitle() {
    const next = titleDraft.trim();
    if (!next || next === checklist.title) {
      setEditingTitle(false);
      setTitleDraft(checklist.title);
      return;
    }
    startTransition(async () => {
      await renameChecklistAction(checklist.id, projectKey, taskNumber, next);
      setEditingTitle(false);
    });
  }

  function deleteList() {
    if (!confirm(`Удалить чек-лист «${checklist.title}»?`)) return;
    startTransition(async () => {
      await deleteChecklistAction(checklist.id, projectKey, taskNumber);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-3">
      <div className="flex items-center gap-2">
        {editingTitle && canEdit ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                saveTitle();
              } else if (e.key === 'Escape') {
                setEditingTitle(false);
                setTitleDraft(checklist.title);
              }
            }}
            disabled={pending}
            className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm font-medium"
          />
        ) : (
          <button
            type="button"
            onClick={() => canEdit && setEditingTitle(true)}
            className={
              'flex-1 text-left text-sm font-medium ' +
              (canEdit ? 'hover:underline' : 'cursor-default')
            }
            disabled={!canEdit}
          >
            {checklist.title}
          </button>
        )}
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {done}/{total}
        </span>
        {canEdit ? (
          <button
            type="button"
            onClick={deleteList}
            disabled={pending}
            className="text-muted-foreground hover:text-red-600 disabled:opacity-50"
            aria-label="Удалить чек-лист"
            title="Удалить чек-лист"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {total > 0 ? (
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}

      <ul className="flex flex-col gap-1">
        {checklist.items.map((item) => (
          <ChecklistItemRow
            key={item.id}
            item={item}
            projectKey={projectKey}
            taskNumber={taskNumber}
            canDelete={canEdit}
          />
        ))}
      </ul>

      <NewItemInput
        checklistId={checklist.id}
        projectKey={projectKey}
        taskNumber={taskNumber}
        canAdd={canEdit}
      />
    </div>
  );
}

function ChecklistItemRow({
  item,
  projectKey,
  taskNumber,
  canDelete,
}: {
  item: Item;
  projectKey: string;
  taskNumber: number;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimisticDone, setOptimisticDone] = useState(item.isDone);

  function toggle() {
    const next = !optimisticDone;
    setOptimisticDone(next);
    startTransition(async () => {
      const res = await toggleChecklistItemAction(item.id, projectKey, taskNumber, next);
      if (!res.ok) setOptimisticDone(!next);
    });
  }

  function del() {
    startTransition(async () => {
      await deleteChecklistItemAction(item.id, projectKey, taskNumber);
      router.refresh();
    });
  }

  return (
    <li className="flex items-center gap-2 group">
      <input
        type="checkbox"
        checked={optimisticDone}
        onChange={toggle}
        disabled={pending}
        className="h-4 w-4 cursor-pointer rounded border-input"
      />
      <span
        className={
          'flex-1 text-sm ' +
          (optimisticDone ? 'text-muted-foreground line-through' : '')
        }
      >
        {item.body}
      </span>
      {canDelete ? (
        <button
          type="button"
          onClick={del}
          disabled={pending}
          aria-label="Удалить пункт"
          className="text-muted-foreground opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </li>
  );
}

function NewItemInput({
  checklistId,
  projectKey,
  taskNumber,
  canAdd,
}: {
  checklistId: string;
  projectKey: string;
  taskNumber: number;
  canAdd: boolean;
}) {
  const [body, setBody] = useState('');
  const [pending, startTransition] = useTransition();

  if (!canAdd) return null;

  function add() {
    const t = body.trim();
    if (!t) return;
    startTransition(async () => {
      const res = await addChecklistItemAction(checklistId, projectKey, taskNumber, t);
      if (res.ok) setBody('');
    });
  }

  return (
    <div className="flex items-center gap-2">
      <span className="ml-[2px] inline-block h-4 w-4 rounded border border-dashed border-muted-foreground/40" />
      <input
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        placeholder="Новый пункт…"
        disabled={pending}
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
      />
      {body.trim() ? (
        <button
          type="button"
          onClick={add}
          disabled={pending}
          className="rounded-md border border-input px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-50"
        >
          <Check className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

function NewChecklistButton({
  taskId,
  projectKey,
  taskNumber,
}: {
  taskId: string;
  projectKey: string;
  taskNumber: number;
}) {
  const [pending, startTransition] = useTransition();
  function add() {
    startTransition(async () => {
      await createChecklistAction(taskId, projectKey, taskNumber);
    });
  }
  return (
    <button
      type="button"
      onClick={add}
      disabled={pending}
      className="inline-flex items-center gap-1 self-start rounded-md border border-dashed border-input px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
    >
      <Plus className="h-3 w-3" />
      Добавить чек-лист
    </button>
  );
}
