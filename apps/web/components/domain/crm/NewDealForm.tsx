'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import { createDealAction } from '@/actions/crm';

type Opt = { id: string; name: string };

export function NewDealForm({
  pipelineId,
  stages,
  contacts,
  projects = [],
}: {
  pipelineId: string;
  stages: Opt[];
  contacts: Opt[];
  /** Pre-labeled as `KEY · name`. */
  projects?: Opt[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [contactId, setContactId] = useState('');
  const [stageId, setStageId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    if (title.trim().length < 2) {
      setError('Название ≥ 2 символов');
      return;
    }
    startTransition(async () => {
      const res = await createDealAction({
        pipelineId,
        title: title.trim(),
        amount: amount || null,
        contactId: contactId || null,
        stageId: stageId || null,
        projectId: projectId || null,
      });
      if (res.ok) {
        setTitle('');
        setAmount('');
        setContactId('');
        setStageId('');
        setProjectId('');
        router.refresh();
      } else {
        setError(res.error.message);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={pending}
        maxLength={200}
        placeholder="Название сделки"
        className="h-9 min-w-[12rem] flex-1 rounded-md border border-input bg-background px-2 text-sm"
      />
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        disabled={pending}
        inputMode="decimal"
        placeholder="Сумма"
        className="h-9 w-28 rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums"
      />
      <select
        value={contactId}
        onChange={(e) => setContactId(e.target.value)}
        disabled={pending}
        aria-label="Контакт"
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
      >
        <option value="">Без контакта</option>
        {contacts.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <select
        value={stageId}
        onChange={(e) => setStageId(e.target.value)}
        disabled={pending}
        aria-label="Стадия"
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
      >
        <option value="">Первая стадия</option>
        {stages.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      {projects.length > 0 ? (
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          disabled={pending}
          aria-label="Проект"
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">Без проекта</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      ) : null}
      <Button type="button" size="sm" onClick={submit} disabled={pending || title.trim() === ''}>
        <Plus className="mr-1 h-4 w-4" />
        {pending ? 'Создаю…' : 'Сделка'}
      </Button>
      {error ? <span className="w-full text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
