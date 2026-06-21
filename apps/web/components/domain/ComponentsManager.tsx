'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Trash2, Check, X } from 'lucide-react';
import { Input } from '@giper/ui/components/Input';
import { Button } from '@giper/ui/components/Button';
import {
  createComponentAction,
  updateComponentAction,
  deleteComponentAction,
} from '@/actions/components';
import type { ComponentRow } from '@/lib/components/listComponentsForProject';

type Member = { id: string; name: string };

type Props = {
  projectKey: string;
  initial: ComponentRow[];
  members: Member[];
  canManage: boolean;
};

export function ComponentsManager({ projectKey, initial, members, canManage }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [leadId, setLeadId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editLead, setEditLead] = useState('');

  function create() {
    setError(null);
    if (name.trim().length < 2) {
      setError('Название: минимум 2 символа');
      return;
    }
    startTransition(async () => {
      const res = await createComponentAction({ projectKey, name: name.trim(), leadId: leadId || null });
      if (res.ok) {
        setName('');
        setLeadId('');
        router.refresh();
      } else setError(res.error.message);
    });
  }

  function startEdit(c: ComponentRow) {
    setEditId(c.id);
    setEditName(c.name);
    setEditLead(c.lead?.id ?? '');
    setError(null);
  }

  function saveEdit(id: string) {
    startTransition(async () => {
      const res = await updateComponentAction(id, { name: editName.trim(), leadId: editLead || null });
      if (res.ok) {
        setEditId(null);
        router.refresh();
      } else setError(res.error.message);
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteComponentAction(id);
      if (res.ok) router.refresh();
      else setError(res.error.message);
    });
  }

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="cmp-name" className="text-xs font-medium text-muted-foreground">Название компонента</label>
            <Input
              id="cmp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Frontend / API / Биллинг"
              maxLength={80}
              className="h-9 w-56"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="cmp-lead" className="text-xs font-medium text-muted-foreground">Ответственный</label>
            <select
              id="cmp-lead"
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
              className="h-9 w-44 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">— Не задан</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          <Button onClick={create} disabled={pending}>Создать компонент</Button>
        </div>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {initial.length === 0 ? (
        <p className="text-sm text-muted-foreground">Компонентов пока нет.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {initial.map((c) => {
            const editing = editId === c.id;
            return (
              <li key={c.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  {editing ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={80} className="h-8 w-48" />
                      <select value={editLead} onChange={(e) => setEditLead(e.target.value)} className="h-8 w-40 rounded-md border border-input bg-background px-2 text-sm">
                        <option value="">— Не задан</option>
                        {members.map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                      <button type="button" onClick={() => saveEdit(c.id)} disabled={pending} className="rounded p-1 text-emerald-600 hover:bg-muted" aria-label="Сохранить">
                        <Check className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => setEditId(null)} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Отмена">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{c.name}</span>
                      {c.lead ? <span className="text-xs text-muted-foreground">отв.: {c.lead.name}</span> : null}
                      <span className="text-xs tabular-nums text-muted-foreground">{c.taskCount} задач</span>
                    </div>
                  )}
                </div>
                {canManage && !editing ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => startEdit(c)} disabled={pending} title="Редактировать" className="rounded p-1.5 text-muted-foreground hover:bg-muted">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => remove(c.id)} disabled={pending} title="Удалить" className="rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-muted">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
